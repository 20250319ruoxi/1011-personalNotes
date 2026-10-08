ERRORS = {
    "INVALID_PARAM":           (400, "参数不合法，请检查后重试"),
    "EMAIL_INVALID":           (400, "请输入正确的邮箱地址"),
    "EMAIL_EXISTS":            (409, "该邮箱已被注册"),
    "USERNAME_EXISTS":         (409, "该用户名已被占用"),
    "PASSWORD_WEAK":           (400, "密码长度需为 8-64 位，且包含字母与数字"),
    "PASSWORD_MISMATCH":       (400, "两次输入的密码不一致"),
    "PASSWORD_WRONG":          (400, "原密码不正确"),
    "INVALID_CREDENTIALS":     (401, "邮箱或密码错误"),
    "RATE_LIMITED":            (429, "尝试过于频繁，请稍后再试"),
    "UNAUTHORIZED":            (401, "请先登录"),
    "CSRF_INVALID":            (403, "请求校验失败，请刷新页面后重试"),
    "FORBIDDEN":               (403, "没有权限执行该操作"),
    "NOT_FOUND":               (404, "请求的内容不存在"),
    "SHARE_DISABLED":          (404, "该分享链接已失效"),
    "SHARE_PASSWORD_REQUIRED": (401, "该笔记需要密码访问"),
    "SHARE_PASSWORD_WRONG":    (401, "访问密码错误"),
    "TAG_TOO_MANY":            (400, "最多只能添加 5 个标签"),
    "CONTENT_TOO_LONG":        (400, "输入内容超出长度限制"),
    "UPLOAD_TOO_LARGE":        (413, "图片大小不能超过 5MB"),
    "UPLOAD_TYPE_INVALID":     (400, "仅支持 JPG、PNG、GIF、WebP 格式的图片"),
    "STORAGE_QUOTA_EXCEEDED":  (413, "存储空间不足，请先清理历史图片"),
    "ALREADY_FAVORITED":       (409, "已收藏过该笔记"),
    "METHOD_NOT_ALLOWED":      (405, "请求方法不被支持"),
    "UNSUPPORTED_MEDIA_TYPE":  (415, "请求格式不受支持"),
    "INTERNAL_ERROR":          (500, "服务器开小差了，请稍后重试"),
}


def error_status(code):
    return ERRORS.get(code, ERRORS["INTERNAL_ERROR"])[0]


def error_message(code):
    return ERRORS.get(code, ERRORS["INTERNAL_ERROR"])[1]
