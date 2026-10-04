/** 设置首页的一项。每一项对应自己的路由。 */
export const SETTINGS_PAGES = [
  {
    path: "/settings/profile",
    title: "个人资料",
    lede: "头像和名字",
  },
  {
    path: "/settings/appearance",
    title: "外观",
    lede: "浅色、深色或跟随系统",
  },
  {
    path: "/settings/password",
    title: "修改密码",
    lede: "改完后所有设备都要重新登录",
  },
  {
    path: "/settings/tokens",
    title: "接口令牌",
    lede: "给脚本和外部 Agent 用",
  },
] as const;
