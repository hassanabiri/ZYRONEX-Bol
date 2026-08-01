import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "ar";

const STORAGE_KEY = "zyronex.language";

/**
 * Translation dictionary keyed by the English source string.
 * Missing keys fall back to the English text, so untranslated UI never breaks.
 */
const ar: Record<string, string> = {
  // Sidebar / navigation
  Overview: "نظرة عامة",
  Build: "البناء",
  Operate: "التشغيل",
  Platform: "المنصة",
  Dashboard: "لوحة التحكم",
  Workspace: "مساحة العمل",
  Agents: "الوكلاء",
  Workflow: "سير العمل",
  Knowledge: "قاعدة المعرفة",
  Memory: "الذاكرة",
  Voice: "الصوت",
  Integrations: "التكاملات",
  Resources: "الموارد",
  Billing: "الفوترة",
  Developer: "المطوّر",
  Administration: "الإدارة",
  Settings: "الإعدادات",
  "Agent Operating Platform": "منصة تشغيل الوكلاء",
  Plan: "الباقة",

  // Top bar
  Workspaces: "مساحات العمل",
  "No workspace": "لا توجد مساحة عمل",
  "No workspaces available": "لا توجد مساحات عمل متاحة",
  "Workspace settings": "إعدادات مساحة العمل",
  "Search workspace…": "ابحث في مساحة العمل…",
  "Search workspace": "بحث في مساحة العمل",
  Search: "بحث",
  "Toggle theme": "تبديل المظهر",
  Language: "اللغة",
  English: "English",
  Arabic: "العربية",
  Notifications: "الإشعارات",
  "No notifications yet.": "لا توجد إشعارات بعد.",
  "Signed in": "تم تسجيل الدخول",
  Profile: "الملف الشخصي",
  "Sign out": "تسجيل الخروج",

  // Dashboard
  "Operational overview of your agent estate. Modules are scaffolded and awaiting configuration.":
    "نظرة تشغيلية على منظومة الوكلاء لديك. الوحدات جاهزة هيكلياً وبانتظار الإعداد.",
  plan: "باقة",
  "Configure workspace": "إعداد مساحة العمل",
  "Workspace Status": "حالة مساحة العمل",
  Operational: "تعمل بشكل طبيعي",
  "All workspace services reachable": "جميع خدمات مساحة العمل متاحة",
  Healthy: "سليمة",
  "No agents provisioned yet": "لم يتم إنشاء أي وكيل بعد",
  "Compute and runtime pools": "موارد الحوسبة وبيئات التشغيل",
  "Connected external systems": "الأنظمة الخارجية المتصلة",
  "Indexed knowledge sources": "مصادر المعرفة المفهرسة",
  "Voice channels configured": "قنوات الصوت المُهيّأة",
  "Current cycle consumption": "استهلاك الدورة الحالية",
  "Recent Activity": "النشاط الأخير",
  "Audit trail across agents, workflows and members.":
    "سجل التدقيق عبر الوكلاء وسير العمل والأعضاء.",
  "No activity recorded": "لا يوجد نشاط مُسجّل",
  "Events will appear here once agents and workflows are running in this workspace.":
    "ستظهر الأحداث هنا بمجرد تشغيل الوكلاء وسير العمل في مساحة العمل هذه.",
  "System Health": "صحة النظام",
  API: "واجهة البرمجة",
  Database: "قاعدة البيانات",
  Realtime: "الزمن الفعلي",
  Storage: "التخزين",
  Nominal: "طبيعي",
  "You're all caught up.": "لا جديد لديك.",

  // Module scaffold
  "Not configured": "غير مُهيّأ",
  "Module scaffold ready": "هيكل الوحدة جاهز",
  "Structure, routing and access control are in place. Implementation lands in a later phase.":
    "الهيكل والتوجيه والتحكم بالصلاحيات جاهزة. التنفيذ التفصيلي في مرحلة لاحقة.",

  // Auth
  "The operating platform for": "منصة التشغيل لـ",
  "AI agents": "وكلاء الذكاء الاصطناعي",
  "Build, orchestrate, govern and scale autonomous agents across every workspace — with enterprise-grade access control, observability and cost management.":
    "ابنِ ونسّق وحوكم ووسّع الوكلاء المستقلين عبر كل مساحات العمل — مع تحكم بالصلاحيات ومراقبة وإدارة تكاليف بمستوى المؤسسات.",
  "Sign in to your workspace": "سجّل الدخول إلى مساحة عملك",
  "Create your account": "أنشئ حسابك",
  "Enter your credentials to access the platform.": "أدخل بياناتك للوصول إلى المنصة.",
  "A personal workspace is provisioned automatically.": "يتم إنشاء مساحة عمل شخصية تلقائياً.",
  "Forgot password?": "نسيت كلمة المرور؟",
  "Forgot your password?": "هل نسيت كلمة المرور؟",
  "Enter your email and we'll send you a link to set a new password.": "أدخل بريدك الإلكتروني وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.",
  "Send reset link": "إرسال رابط الاستعادة",
  "Reset link sent. Check your inbox.": "تم إرسال الرابط. تحقق من بريدك.",
  "Could not send reset link": "تعذّر إرسال رابط الاستعادة",
  "Back to sign in": "العودة لتسجيل الدخول",
  "Set a new password": "تعيين كلمة مرور جديدة",
  "Choose a strong password you haven't used before.": "اختر كلمة مرور قوية لم تستخدمها من قبل.",
  "New password": "كلمة المرور الجديدة",
  "Confirm password": "تأكيد كلمة المرور",
  "Passwords do not match": "كلمتا المرور غير متطابقتين",
  "Password updated": "تم تحديث كلمة المرور",
  "Could not update password": "تعذّر تحديث كلمة المرور",
  "Update password": "تحديث كلمة المرور",
  "Create your first workspace": "أنشئ مساحة عملك الأولى",
  "Workspaces isolate your agents, knowledge, members and billing.": "مساحات العمل تعزل الوكلاء والمعرفة والأعضاء والفوترة.",
  "Workspace name": "اسم مساحة العمل",
  "Slug (optional)": "المعرّف (اختياري)",
  "Create workspace": "إنشاء مساحة العمل",
  "Workspace created": "تم إنشاء مساحة العمل",
  "Could not create workspace": "تعذّر إنشاء مساحة العمل",
  "Sign in": "تسجيل الدخول",
  Register: "إنشاء حساب",
  "Full name": "الاسم الكامل",
  "Work email": "البريد الإلكتروني",
  Password: "كلمة المرور",
  "Create account": "إنشاء الحساب",
  "Please wait…": "يرجى الانتظار…",
  "Authentication failed": "فشل تسجيل الدخول",
  "Check your inbox to confirm your email address.": "تحقق من بريدك لتأكيد عنوانك الإلكتروني.",
  "Loading ZYRONEX…": "جارٍ تحميل ZYRONEX…",

  // Workspace home
  Status: "الحالة",
  Created: "تاريخ الإنشاء",
  Owner: "المالك",
  Slug: "المعرّف",
  You: "أنت",
  you: "أنت",
  active: "نشط",
  suspended: "موقوف",
  pending: "قيد الانتظار",
  free: "مجاني",
  Free: "مجاني",
  Starter: "المبتدئ",
  Growth: "النمو",
  Enterprise: "المؤسسات",
  "Active AI Workers": "العمال الأذكياء النشطون",
  "Connected Integrations": "التكاملات المتصلة",
  "Knowledge Bases": "قواعد المعرفة",
  "Memory Usage": "استهلاك الذاكرة",
  "Storage Usage": "استهلاك التخزين",
  "Voice Numbers": "الأرقام الصوتية",
  "Team Members": "أعضاء الفريق",
  "API Usage": "استخدام الواجهة البرمجية",
  "Monthly Requests": "الطلبات الشهرية",
  "Recent Activity": "النشاط الأخير",
  "No activity recorded": "لا يوجد نشاط مسجل",
  "Quick Actions": "إجراءات سريعة",
  "Jump straight into the most common workspace tasks.": "ابدأ مباشرة بأكثر المهام استخداماً.",
  "Create AI Worker": "إنشاء عامل ذكي",
  "Connect Integration": "ربط تكامل",
  "Upload Knowledge": "رفع معرفة",
  "Invite Team Member": "دعوة عضو",
  "Open Billing": "فتح الفوترة",
  "Developer Center": "مركز المطوّرين",

  // Workspace management
  "Workspace Management": "إدارة مساحة العمل",
  Team: "الفريق",
  Roles: "الأدوار",
  Permissions: "الصلاحيات",
  General: "عام",
  Branding: "الهوية البصرية",
  "Core identity of this workspace.": "الهوية الأساسية لمساحة العمل.",
  "Workspace name": "اسم مساحة العمل",
  "Subscription plan": "خطة الاشتراك",
  "Logo URL": "رابط الشعار",
  "Brand color": "لون الهوية",
  "Logo and accent color used across the workspace.": "الشعار واللون المستخدمان في مساحة العمل.",
  "Domain, region & locale": "النطاق والمنطقة واللغة",
  "Custom domain": "نطاق مخصص",
  Region: "المنطقة",
  Timezone: "المنطقة الزمنية",
  "Save changes": "حفظ التغييرات",
  "Workspace settings saved": "تم حفظ الإعدادات",
  "Danger Zone": "منطقة الخطر",
  "Delete workspace": "حذف مساحة العمل",
  "This action cannot be undone. Type the workspace name to confirm.":
    "لا يمكن التراجع عن هذا الإجراء. اكتب اسم مساحة العمل للتأكيد.",
  Cancel: "إلغاء",
  Delete: "حذف",
  Edit: "تعديل",
  Clone: "نسخ",
  Back: "رجوع",
  Continue: "متابعة",

  // Team
  "Team Management": "إدارة الفريق",
  "Invite people and control their access level.": "ادعُ الأشخاص وتحكم في مستوى وصولهم.",
  "Invite Member": "دعوة عضو",
  "Search members…": "ابحث عن الأعضاء…",
  "All roles": "كل الأدوار",
  "All statuses": "كل الحالات",
  Role: "الدور",
  owner: "مالك",
  admin: "مشرف",
  member: "عضو",
  viewer: "مشاهد",
  "Member actions": "إجراءات العضو",
  "Suspend Member": "إيقاف العضو",
  "Reactivate Member": "إعادة تفعيل العضو",
  "Remove Member": "إزالة العضو",
  "No team members found": "لا يوجد أعضاء",
  "Pending Invitations": "الدعوات المعلقة",
  "No pending invitations": "لا توجد دعوات معلقة",
  "Send Invitation": "إرسال الدعوة",
  Revoke: "إلغاء الدعوة",
  Email: "البريد الإلكتروني",

  // Roles & permissions
  "Role Management": "إدارة الأدوار",
  "Create Role": "إنشاء دور",
  "Edit Role": "تعديل الدور",
  "Save Role": "حفظ الدور",
  "Role name": "اسم الدور",
  Description: "الوصف",
  "No custom roles yet": "لا توجد أدوار مخصصة",
  "Permission Matrix": "مصفوفة الصلاحيات",
  "Enable or disable permissions per module.": "فعّل أو عطّل الصلاحيات لكل وحدة.",
  workspace: "مساحة العمل",
  agents: "الوكلاء",
  workflow: "سير العمل",
  voice: "الصوت",
  knowledge: "المعرفة",
  billing: "الفوترة",
  developer: "المطوّر",
  administration: "الإدارة",

  // Wizard
  "Create workspace": "إنشاء مساحة عمل",
  "Create your first workspace": "أنشئ مساحة عملك الأولى",
  "Workspace created": "تم إنشاء مساحة العمل",
  "Ready to create": "جاهز للإنشاء",
  Logo: "الشعار",
};


const dictionaries: Record<Language, Record<string, string>> = { en: {}, ar };

type I18nContextValue = {
  language: Language;
  dir: "ltr" | "rtl";
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Language | null;
    if (stored === "ar" || stored === "en") setLanguageState(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      dir: language === "ar" ? "rtl" : "ltr",
      setLanguage,
      t: (text: string) => dictionaries[language][text] ?? text,
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const fallbackI18n: I18nContextValue = {
  language: "en",
  dir: "ltr",
  setLanguage: () => {},
  t: (text: string) => text,
};

export function useI18n() {
  return useContext(I18nContext) ?? fallbackI18n;
}
