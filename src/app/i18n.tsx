"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "zh";
type Vars = Record<string, string | number>;
type Dictionary = Record<string, string>;

const en: Dictionary = {
  skip: "Skip to workspace", home: "Frame Note home", edition: "/ review studio", local: "Review workspace",
  signOut: "Sign out", opening: "Loading your review space…", dismiss: "Dismiss", saving: "Saving…", reviewSpace: "Review space", inbox: "Inbox", recent: "Recent projects", noProjects: "No projects yet", startHere: "Start here", startHereBody: "Create a private project to collect screens and feedback.", howItWorks: "How it works", stepUpload: "Upload a screen", stepCompare: "Compare revisions", stepDiscuss: "Discuss with your team",
  eyebrow: "DESIGN REVIEW", heroTitle: "Review every detail.",
  heroLead: "Upload a screen, compare revisions, and leave feedback exactly where it belongs.",
  startDemo: "Open review space", preparing: "Preparing your review space…", demoMeta: "Private workspace · No account required",
  preview: "Upload → compare → discuss.", sharingPreview: "Share a view-only link when your review is ready.",
  worktable: "Your projects", presentations: "Projects", saved: "Keep screens, versions, and notes together.", essentials: "Essentials", overview: "Overview", dashboard: "Workspace overview",
  presentationTitle: "Project name", presentationPlaceholder: "e.g. Mobile checkout", createPresentation: "Create project",
  privateWorkspace: "Private workspace", onlyBrowser: "Private project space", designReview: "Review",
  inProgress: "In progress", gettingStarted: "Ready to start", screens: "screens", screen: "screen", startPresentation: "Choose a project to begin.",
  clearSpace: "Nothing here yet", createThenAdd: "Create a project, then add the first screen.",
  noScreens: "No screens yet", letWork: "Add your first screen", uploadBegin: "Upload a design image to start reviewing.",
  needsImage: "This screen needs an image.", finishScreen: "Upload the first version below to start reviewing.",
  originalProportions: "Original size preserved", version: "Version", review: "Review", compare: "Compare revisions",
  backReview: "Back to review", uploadAnother: "Upload another version to compare.", commentsStay: "Comments are attached to review v{n}.",
  addScreen: "Add screen", imageTypes: "PNG, JPEG or WebP · up to 10 MiB", screenTitle: "Screen name", screenPlaceholder: "e.g. Checkout home",
  imageFile: "Image file", chooseFile: "Choose file", noFileSelected: "No file selected", uploadScreen: "Upload screen", nextRevision: "Keep the next revision", addTo: "Add to “{title}”. Previous versions stay unchanged.",
  newVersionImage: "New version image", uploadVersion: "Upload version", privateLocal: "Saved to this workspace", reviewSize: "Review v{n} · {w} × {h} px",
  comments: "Feedback", feedbackAttached: "Notes stay attached to this version.", addPin: "Add note", loadingComments: "Loading feedback…",
  noComments: "No comments on this version yet.", clickImage: "Click the image to choose a location, or place a note at the center.", placeCenter: "Place at center",
  horizontal: "Horizontal position (%)", vertical: "Vertical position (%)", comment: "Comment", postComment: "Post comment", cancel: "Cancel",
  open: "Open", resolved: "Resolved", message: "message", messages: "messages", discussion: "Discussion #{n}", reply: "Reply", postReply: "Post reply",
  resolve: "Resolve thread", reopen: "Reopen thread", original: "Original comment", guest: "Guest", owner: "Owner", reloadComments: "Reload comments",
  compareLabel: "Compare versions of {title}", left: "Left version", right: "Right version", swap: "Swap versions", sideBySide: "Side by side", overlay: "Overlay",
  loadingImage: "Loading {side} image…", imageUnavailable: "{side} image unavailable", imageFailed: "The image could not be loaded.", retryImage: "Retry image",
  revealLeft: "Reveal left version", dragHint: "Drag across the image, or use the slider and arrow keys.", comparisonCaption: "Same scale, aligned top-left. Blank space shows differences in image size or transparency.",
  invite: "Share with your team", share: "Share review", shareHelp: "Send a view-only link to your client or team. Turn on comments when you want feedback.",
  linkDuration: "Link duration", hour: "1 hour", hours: "24 hours", createLink: "Create view-only link", allowGuests: "Allow comments", shareLimit: "Links are private until you share them.",
  newLink: "New review link", copy: "Copy link", copied: "Link copied.", copyBlocked: "Copy was blocked. Select and copy the link above.", copyNow: "Copy the link before closing this window.", loadingLinks: "Loading links…", link: "Link", expires: "Expires", revoked: "Revoked", commentsOn: "Comments on", readOnly: "Read only", revoke: "Revoke link", retryLinks: "Retry links",
  errorTry: "Please try again.", unavailableTitle: "This link is unavailable.", unavailableBody: "It may have expired, been revoked, or be incomplete. Ask the owner for a new link.", viewingOnly: "Viewing only · No editing access", retryLeft: "Retry left image", retryRight: "Retry right image",
  language: "Language", english: "English", chinese: "中文", switchToChinese: "切换到中文", switchToEnglish: "Switch to English", settings: "Settings", workspaceSettings: "Workspace settings", settingsHelp: "Manage the preferences for this review workspace.", languageHelp: "Choose the language used by the interface.",
};
const zh: Dictionary = {
  ...en,
  skip: "跳转到工作区", home: "Frame Note 首页", edition: "/ 设计评审", local: "设计评审", signOut: "退出", opening: "正在加载评审空间…", dismiss: "关闭", saving: "正在保存…", reviewSpace: "评审空间", inbox: "收件箱", recent: "最近项目", noProjects: "还没有项目", startHere: "从这里开始", startHereBody: "创建一个私有项目，集中管理画面和反馈。", howItWorks: "使用流程", stepUpload: "上传画面", stepCompare: "比较版本", stepDiscuss: "和团队讨论", essentials: "核心功能", overview: "概览", dashboard: "工作区概览",
  eyebrow: "设计评审", heroTitle: "看清每一个细节。", heroLead: "上传画面、比较版本，并在准确的位置留下反馈。", startDemo: "进入评审空间", preparing: "正在准备评审空间…", demoMeta: "私有工作区 · 无需注册",
  preview: "上传 → 对比 → 讨论。", sharingPreview: "准备好后，分享只读链接给客户或团队。", worktable: "你的项目", presentations: "项目", saved: "把画面、版本和反馈集中在一起。",
  presentationTitle: "项目名称", presentationPlaceholder: "例如：移动端结算页", createPresentation: "创建项目", privateWorkspace: "工作区", onlyBrowser: "你的文件会保存在这个工作区。",
  designReview: "评审", inProgress: "进行中", gettingStarted: "准备开始", screens: "个画面", screen: "个画面", startPresentation: "选择一个项目开始。", clearSpace: "这里还没有内容", createThenAdd: "创建项目，然后添加第一个画面。", noScreens: "还没有画面", letWork: "添加第一个画面", uploadBegin: "上传设计图，开始进行评审。", needsImage: "为这个画面添加图片", finishScreen: "在下方上传第一个版本即可开始评审。", originalProportions: "保留图片原始尺寸。",
  version: "版本", review: "评审", compare: "对比版本", backReview: "返回评审", uploadAnother: "再添加一个版本来比较变化。", commentsStay: "反馈会跟随评审版本 v{n}。", addScreen: "添加画面", imageTypes: "PNG、JPEG 或 WebP · 最大 10 MiB", screenTitle: "画面名称", screenPlaceholder: "例如：结算首页", imageFile: "图片文件", chooseFile: "选择文件", noFileSelected: "未选择文件", uploadScreen: "上传画面", nextRevision: "添加下一版", addTo: "添加到“{title}”。之前的版本会保留。", newVersionImage: "新版本图片", uploadVersion: "上传版本", privateLocal: "已保存到这个项目", reviewSize: "评审 v{n} · {w} × {h} 像素",
  comments: "反馈", feedbackAttached: "反馈会固定在当前版本上。", addPin: "添加备注", loadingComments: "正在加载反馈…", noComments: "这个版本还没有反馈。", clickImage: "点击图片选择位置，或将备注放在中心。", placeCenter: "放在中心", horizontal: "水平位置（%）", vertical: "垂直位置（%）", comment: "备注内容", postComment: "发布备注", cancel: "取消", open: "待处理", resolved: "已解决", message: "条消息", messages: "条消息", discussion: "讨论 #{n}", reply: "回复", postReply: "发布回复", resolve: "解决讨论", reopen: "重新打开", original: "原始备注", guest: "访客", owner: "所有者", reloadComments: "重新加载反馈", settings: "设置", workspaceSettings: "工作区设置", settingsHelp: "管理这个评审空间的显示偏好。", languageHelp: "选择界面使用的语言。",
  compareLabel: "对比 {title} 的版本", left: "左侧版本", right: "右侧版本", swap: "交换版本", sideBySide: "并排查看", overlay: "叠加查看", loadingImage: "正在加载{side}图片…", imageUnavailable: "{side}图片不可用", imageFailed: "图片加载失败。", retryImage: "重试加载", retryLeft: "重试左侧图片", retryRight: "重试右侧图片", revealLeft: "显示左侧版本", dragHint: "拖动图片，或使用滑块和方向键。", comparisonCaption: "两张图片使用相同比例并从左上角对齐，空白区域表示尺寸或透明度差异。", unavailableTitle: "此链接不可用。", unavailableBody: "链接可能已过期、被撤销或不完整，请向所有者索要新链接。", viewingOnly: "仅可查看 · 无编辑权限",
  invite: "分享给团队", share: "分享评审", shareHelp: "发送只读链接给客户或团队。需要收集反馈时，再开启评论。", linkDuration: "链接有效期", hour: "1 小时", hours: "24 小时", createLink: "创建只读链接", allowGuests: "允许评论", shareLimit: "链接默认保持私密，创建后再分享给需要的人。", newLink: "新的评审链接", copy: "复制链接", copied: "链接已复制。", copyBlocked: "复制被阻止，请手动选择上方链接。", copyNow: "关闭这个页面前请先复制链接。", loadingLinks: "正在加载链接…", link: "链接", expires: "到期时间", revoked: "已撤销", commentsOn: "已开启评论", readOnly: "仅查看", revoke: "撤销链接", retryLinks: "重试加载链接", errorTry: "请稍后再试。", language: "语言", english: "English", chinese: "中文", switchToChinese: "切换到中文", switchToEnglish: "Switch to English",
};

const LanguageContext = createContext<{ lang: Locale; t: (key: string, vars?: Vars) => string; toggle: () => void }>({ lang: "en", t: (key) => en[key] ?? key, toggle: () => undefined });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Locale>("en");
  useEffect(() => { const saved = window.localStorage.getItem("frame-note-language"); if (saved === "zh" || saved === "en") setLang(saved); }, []);
  useEffect(() => { window.localStorage.setItem("frame-note-language", lang); document.documentElement.lang = lang === "zh" ? "zh-CN" : "en"; }, [lang]);
  const value = useMemo(() => ({ lang, t: (key: string, vars: Vars = {}) => Object.entries(vars).reduce((s, [name, val]) => s.replaceAll(`{${name}}`, String(val)), (lang === "zh" ? zh : en)[key] ?? key), toggle: () => setLang((current) => current === "en" ? "zh" : "en") }), [lang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { return useContext(LanguageContext); }
export function LanguageToggle() { const { lang, toggle, t } = useLanguage(); return <button className="language-toggle" onClick={toggle} aria-label={lang === "en" ? t("switchToChinese") : t("switchToEnglish")}><span className={lang === "en" ? "active" : ""}>EN</span><span aria-hidden="true">/</span><span className={lang === "zh" ? "active" : ""}>中文</span></button>; }
