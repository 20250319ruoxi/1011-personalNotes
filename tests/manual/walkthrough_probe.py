#!/usr/bin/env python
"""walkthrough_probe.py — 端到端走查脚本的「可执行子集」（不属于 pytest 套件）。

本环境（Windows 无浏览器 / 无 jsdom）无法点击页面，因此把
`tests/manual/end-to-end-walkthrough.md` 中能在 API 层验证的步骤改为用 Flask
test client 真实驱动，逐条打印 HTTP 结果，作为走查的可复现证据。

用法::

    .venv/Scripts/python.exe tests/manual/walkthrough_probe.py

退出码 0 表示全部被覆盖的步骤符合预期；任一断言失败退出码 1。
依赖浏览器/像素的步骤（布局、动画、剪贴板、焦点环可见性、真实 Tab 走查）不在本脚本范围。
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app import create_app           # noqa: E402
from config import Config            # noqa: E402
from core import db as db_module     # noqa: E402

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {label}" + (f"  — {detail}" if detail else ""))
    if not condition:
        FAILURES.append(label)


def csrf(resp):
    return {"X-CSRF-Token": resp.get_json()["data"]["csrf_token"]}


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="walkthrough-")

    class Cfg(Config):
        TESTING = True
        SECRET_KEY = "walkthrough-secret"
        DATABASE = os.path.join(tmpdir, "walkthrough.db")

    application = create_app(Cfg)
    with application.app_context():
        db_module.init_db(application)

    c = application.test_client()
    anon = application.test_client()

    print("== 场景 A：首次到访与注册（未登录） ==")
    r = c.get("/")
    check("A1 GET / 返回 SPA 外壳", r.status_code == 200 and "id=\"app\"" in r.get_data(as_text=True),
          f"{r.status_code}")

    reg = c.post("/api/auth/register", json={
        "email": "walker@example.com", "username": "walker",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    headers = csrf(reg)
    check("A3 POST /api/auth/register 自动建立会话并下发 csrf_token",
          reg.status_code == 200 and reg.get_json()["data"]["csrf_token"], f"{reg.status_code}")
    me = c.get("/api/auth/me")
    check("A3 注册后 GET /api/auth/me 已登录", me.get_json()["data"]["user"]["username"] == "walker")

    print("\n== 场景 B：写笔记与草稿 ==")
    created = c.post("/api/notes", json={"title": "第一篇", "content_md": "# 标题\n\n- a\n- b\n\n> 引用\n\n```\ncode\n```\n[外链](https://example.com)",
                                          "status": "draft"}, headers=headers)
    note = created.get_json()["data"]["note"]
    nid = note["id"]
    check("B7 POST /api/notes(status=draft) 存为草稿", created.status_code == 200 and note["status"] == "draft",
          f"id={nid} status={note['status']}")

    buf = io.BytesIO()
    from PIL import Image
    Image.new("RGB", (8, 8), (200, 180, 150)).save(buf, format="PNG")
    buf.seek(0)
    up = c.post("/api/uploads/image", data={"file": (buf, "本地图片.png")},
                headers=headers, content_type="multipart/form-data")
    url = up.get_json()["data"]["url"]
    check("B6 POST /api/uploads/image 返回 /static/uploads/u* URL", up.status_code == 200 and url.startswith("/static/uploads/u"),
          url)

    pub = c.put(f"/api/notes/{nid}", json={"title": "第一篇", "content_md": note["content_md"],
                                           "status": "private", "tags": ["技术"]}, headers=headers)
    check("B10 PUT /api/notes/<id>(status=private) 发布成功",
          pub.status_code == 200 and pub.get_json()["data"]["note"]["status"] == "private")

    print("\n== 场景 C：列表与检索 ==")
    for i, (status, tag) in enumerate([("draft", "生活"), ("private", "技术"), ("private", "阅读")], start=2):
        c.post("/api/notes", json={"title": f"第{i}篇", "content_md": f"正文编号 {i} 关键词番茄",
                                   "status": status, "tags": [tag]}, headers=headers)
    allnotes = c.get("/api/notes?page_size=50").get_json()["data"]
    check("C12 GET /api/notes 总数正确", allnotes["total"] == 4, f"total={allnotes['total']}")
    drafts = c.get("/api/notes?status=draft").get_json()["data"]
    check("C12 status=draft 过滤正确", drafts["total"] == 1, f"draft={drafts['total']}")
    privates = c.get("/api/notes?status=private").get_json()["data"]
    check("C12 status=private 过滤正确", privates["total"] == 3, f"private={privates['total']}")
    search = c.get("/api/notes?q=番茄").get_json()["data"]
    check("C13 正文关键词检索命中 3 篇", search["total"] == 3, f"q=番茄 total={search['total']}")
    tagfilter = c.get("/api/notes?tag=技术").get_json()["data"]
    check("C14 标签筛选命中 2 篇", tagfilter["total"] == 2, f"tag=技术 total={tagfilter['total']}")
    p1 = c.get("/api/notes?page=1&page_size=2").get_json()["data"]
    p2 = c.get("/api/notes?page=2&page_size=2").get_json()["data"]
    ids1 = {n["id"] for n in p1["items"]}
    ids2 = {n["id"] for n in p2["items"]}
    check("C15 分页不重叠且合计等于总数", not (ids1 & ids2) and len(ids1 | ids2) == 4 and p1["total"] == 4,
          f"p1={sorted(ids1)} p2={sorted(ids2)}")

    print("\n== 场景 D：分享与评论 ==")
    sh = c.post(f"/api/notes/{nid}/share", json={}, headers=headers)
    token = sh.get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    check("D17 POST /api/notes/<id>/share 返回分享链接", sh.status_code == 200 and sh.get_json()["data"]["has_password"] is False,
          f"/s/{token}")

    rd = anon.get(f"/api/share/{token}")
    check("D18 匿名 GET /api/share/<token> 可读正文", rd.status_code == 200 and rd.get_json()["data"]["note"]["content_md"],
          f"{rd.status_code}")

    favs_before = anon.get("/api/favorites")
    check("D19 匿名 GET /api/favorites 返回 UNAUTHORIZED（前端据此跳登录）",
          favs_before.status_code == 401 and favs_before.get_json()["code"] == "UNAUTHORIZED")

    cm = c.post(f"/api/share/{token}/comments", json={"content": "来自访客的评论"}, headers=headers)
    check("D20 登录用户 POST 分享页评论成功", cm.status_code == 200 and cm.get_json()["data"]["comment"]["content"] == "来自访客的评论")
    comment_id = cm.get_json()["data"]["comment"]["id"]
    listed = c.get(f"/api/notes/{nid}/comments").get_json()["data"]
    check("D21 作者 GET 详情评论可见且 can_delete", listed["total"] == 1 and listed["items"][0]["can_delete"] is True)
    dele = c.delete(f"/api/comments/{comment_id}", headers=headers)
    check("D22 作者 DELETE /api/comments/<id> 成功", dele.status_code == 200)
    check("D22 删除后评论计数归零", c.get(f"/api/notes/{nid}/comments").get_json()["data"]["total"] == 0)

    c.post(f"/api/notes/{nid}/share", json={"password": "seekrit"}, headers=headers)
    visitor = application.test_client()   # 全新访客会话（尚未解锁该 token）
    locked = visitor.get(f"/api/share/{token}")
    check("D23 设密后新访客读返回 SHARE_PASSWORD_REQUIRED",
          locked.status_code == 401 and locked.get_json()["code"] == "SHARE_PASSWORD_REQUIRED")
    same = anon.get(f"/api/share/{token}")
    print("      [NOTE] 之前已无密解锁过的同一会话不会被回溯上锁："
          f"status={same.status_code}（会话级解锁态，见遗留风险）")
    wrong = visitor.post(f"/api/share/{token}/verify", json={"password": "nope"})
    check("D23 错误密码返回 SHARE_PASSWORD_WRONG",
          wrong.status_code == 401 and wrong.get_json()["code"] == "SHARE_PASSWORD_WRONG")
    right = visitor.post(f"/api/share/{token}/verify", json={"password": "seekrit"})
    check("D23 正确密码解锁并返回正文", right.status_code == 200 and right.get_json()["data"]["note"]["content_md"])

    check("D24 关闭分享 DELETE /api/notes/<id>/share",
          c.delete(f"/api/notes/{nid}/share", headers=headers).status_code == 200)
    gone = anon.get(f"/api/share/{token}")
    check("D24 失效链接返回 SHARE_DISABLED",
          gone.status_code == 404 and gone.get_json()["code"] == "SHARE_DISABLED")

    print("\n== 场景 E：收藏、足迹与个人主页 ==")
    # 重新开启无密分享，模拟「他人经分享链接收藏」
    c.post(f"/api/notes/{nid}/share", json={}, headers=headers)
    friend = application.test_client()
    freg = friend.post("/api/auth/register", json={
        "email": "friend@example.com", "username": "friend",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    fheaders = {"X-CSRF-Token": freg.get_json()["data"]["csrf_token"]}
    friend.get(f"/api/share/{token}")            # 经分享链接解锁
    afav = friend.post("/api/favorites", json={"note_id": nid}, headers=fheaders)
    check("E26 访客登录后经分享链接收藏成功", afav.status_code == 200, f"{afav.status_code}")
    favs = friend.get("/api/favorites").get_json()["data"]
    check("E26 收藏列表含该条且内容可用",
          favs["total"] == 1 and favs["items"][0]["note"]["id"] == nid
          and favs["items"][0]["available"] is True,
          f"total={favs['total']}")

    # 作者在详情页刷新（D21）会记录足迹；连续读两篇以验证倒序
    c.get(f"/api/notes/{nid}")
    c.get("/api/notes/2")
    history = c.get("/api/history").get_json()["data"]
    order_ok = (history["total"] == 2 and history["items"][0]["note"]["id"] == 2
                and history["items"][1]["note"]["id"] == nid
                and history["items"][0]["viewed_at"] >= history["items"][1]["viewed_at"])
    check("E27 GET /api/history 按浏览时间倒序（最新在前）", order_ok,
          f"ids={[it['note']['id'] for it in history['items']]}")
    cleared = c.delete("/api/history", headers=headers)
    check("E28 DELETE /api/history 清空", cleared.status_code == 200 and
          c.get("/api/history").get_json()["data"]["total"] == 0)

    prof = c.put("/api/users/me/profile", json={"username": "walker2", "bio": "你好"}, headers=headers)
    check("E29 PUT /api/users/me/profile 改名与简介", prof.status_code == 200 and prof.get_json()["data"]["user"]["username"] == "walker2")
    pw = c.put("/api/users/me/password", json={"old_password": "passw0rd", "new_password": "newpass1",
                                               "confirm_password": "newpass1"}, headers=headers)
    check("E29 PUT /api/users/me/password 改密成功", pw.status_code == 200)
    fresh = application.test_client()
    relog = fresh.post("/api/auth/login", json={"email": "walker@example.com", "password": "newpass1"})
    check("E29 用新密码重新登录成功", relog.status_code == 200)

    # E30：作者关闭分享后，他人收藏条目变为失效（available=false 且不返回标题/正文）
    c.delete(f"/api/notes/{nid}/share", headers=headers)
    stale = friend.get("/api/favorites").get_json()["data"]
    check("E30 关闭分享后收藏条目 available=false 且不含标题/正文",
          stale["items"][0]["available"] is False
          and stale["items"][0]["note"]["title"] is None
          and "content_md" not in stale["items"][0]["note"])

    print("\n== 场景 F：失效与异常 ==")
    nf = c.get("/api/notes/999999")
    check("F31 GET /api/notes/999999 返回 NOT_FOUND",
          nf.status_code == 404 and nf.get_json()["code"] == "NOT_FOUND")
    inv = c.get("/api/share/invalid-token")
    check("F32 GET /api/share/invalid-token 返回 SHARE_DISABLED",
          inv.status_code == 404 and inv.get_json()["code"] == "SHARE_DISABLED")
    about = c.get("/about")
    check("F33 GET /about 返回 SPA 外壳", about.status_code == 200 and "id=\"app\"" in about.get_data(as_text=True))
    unknown = c.get("/whatever")
    check("F34 GET /whatever 由 SPA 兜底返回 index.html（前端渲染「页面不存在」）",
          unknown.status_code == 200 and "id=\"app\"" in unknown.get_data(as_text=True))
    guard = anon.get("/api/notes")
    check("F35 清空 Cookie 后 GET /api/notes 返回 UNAUTHORIZED",
          guard.status_code == 401 and guard.get_json()["code"] == "UNAUTHORIZED")

    print()
    if FAILURES:
        print(f"失败 {len(FAILURES)} 项：")
        for item in FAILURES:
            print(f"  - {item}")
        return 1
    print("走查脚本可执行子集全部通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
