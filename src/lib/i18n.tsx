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
  "Ready to create": "جاهز للإنشاء",
  Logo: "الشعار",

  // AI Workers
  "AI Workers": "العاملون الأذكياء",
  "Design, organize and govern every AI worker in this workspace. Configuration only — no AI execution.":
    "صمّم ونظّم وأدر كل عامل ذكي في مساحة العمل هذه. إعدادات فقط — بدون تشغيل للذكاء الاصطناعي.",
  "Total Workers": "إجمالي العاملين",
  "Active Workers": "العاملون النشطون",
  "Paused Workers": "العاملون المتوقفون",
  "Draft Workers": "المسودات",
  "Archived Workers": "المؤرشفون",
  "Create Worker": "إنشاء عامل",
  "Five short steps to define a new worker for this workspace.":
    "خمس خطوات قصيرة لتعريف عامل جديد في مساحة العمل.",
  "Search workers…": "ابحث عن العاملين…",
  "All types": "كل الأنواع",
  "Recently updated": "الأحدث تحديثاً",
  "Oldest first": "الأقدم أولاً",
  "Name A–Z": "الاسم أ–ي",
  Worker: "العامل",
  "Worker Name": "اسم العامل",
  "Worker Type": "نوع العامل",
  "Worker actions": "إجراءات العامل",
  "e.g. Support Concierge": "مثال: مساعد الدعم",
  "What is this worker responsible for?": "ما المهام التي يتولاها هذا العامل؟",
  "Avatar URL": "رابط الصورة",
  Color: "اللون",
  Icon: "الأيقونة",
  Purpose: "الغرض",
  "Describe the purpose": "صف الغرض",
  "Name your own worker type": "سمِّ نوع العامل الخاص بك",
  "AI Provider": "مزوّد الذكاء الاصطناعي",
  "Provider name": "اسم المزوّد",
  "Model (optional)": "النموذج (اختياري)",
  "Model identifier": "معرّف النموذج",
  Model: "النموذج",
  "Providers are recorded as configuration only. No credentials are stored and no requests are sent.":
    "تُسجَّل بيانات المزوّد كإعدادات فقط. لا يتم تخزين أي مفاتيح ولا إرسال أي طلبات.",
  Localization: "التوطين",
  Identity: "الهوية",
  Review: "المراجعة",
  "Untitled worker": "عامل بدون اسم",
  "Worker created": "تم إنشاء العامل",
  "Worker updated": "تم تحديث العامل",
  "Worker deleted": "تم حذف العامل",
  "Worker duplicated": "تم نسخ العامل",
  "Worker imported": "تم استيراد العامل",
  "Could not create worker": "تعذّر إنشاء العامل",
  "Action failed": "فشل الإجراء",
  "Import failed": "فشل الاستيراد",
  "The file does not contain a valid worker definition.": "الملف لا يحتوي على تعريف عامل صالح.",
  Import: "استيراد",
  Export: "تصدير",
  Duplicate: "نسخ",
  Activate: "تفعيل",
  Pause: "إيقاف مؤقت",
  Archive: "أرشفة",
  Draft: "مسودة",
  Active: "نشط",
  Paused: "موقوف",
  Archived: "مؤرشف",
  Updated: "آخر تحديث",
  Showing: "عرض",
  of: "من",
  "Previous page": "الصفحة السابقة",
  "Next page": "الصفحة التالية",
  "Loading worker…": "جارٍ تحميل العامل…",
  "Back to AI Workers": "العودة إلى العاملين الأذكياء",
  Summary: "الملخص",
  "Core definition of this worker.": "التعريف الأساسي لهذا العامل.",
  Tags: "الوسوم",
  "Organize workers across teams and use cases.": "نظّم العاملين حسب الفرق وحالات الاستخدام.",
  "No tags yet": "لا توجد وسوم بعد",
  "Add a tag": "أضف وسماً",
  "Remove tag": "إزالة الوسم",
  "Internal Notes": "ملاحظات داخلية",
  "Context for your team. Never sent to any model.": "ملاحظات لفريقك، لا تُرسل لأي نموذج.",
  "Write a note for your team…": "اكتب ملاحظة لفريقك…",
  "Add Note": "إضافة ملاحظة",
  "No notes yet": "لا توجد ملاحظات بعد",
  "Document decisions, prompts to revisit and open questions about this worker.":
    "وثّق القرارات والأسئلة المفتوحة حول هذا العامل.",
  Configuration: "الإعدادات",
  Tools: "الأدوات",
  Activity: "النشاط",
  Versions: "الإصدارات",
  "Save Version": "حفظ إصدار",
  "Version saved": "تم حفظ الإصدار",
  "No versions saved": "لا توجد إصدارات محفوظة",
  "Snapshot the current configuration so you can compare and restore it later.":
    "احفظ نسخة من الإعدادات الحالية لمقارنتها أو استعادتها لاحقاً.",
  "Every change to this worker is captured here as an auditable timeline.":
    "كل تغيير على هذا العامل يُسجَّل هنا ضمن سجل زمني قابل للتدقيق.",
  "No AI workers yet": "لا يوجد عاملون أذكياء بعد",
  "Create your first AI worker to start organizing agent operations in this workspace.":
    "أنشئ أول عامل ذكي لبدء تنظيم عمليات الوكلاء في مساحة العمل.",
  "No matching workers": "لا يوجد عاملون مطابقون",
  "Try a different search term or clear the filters.": "جرّب كلمة بحث أخرى أو امسح عوامل التصفية.",
  "Loading workers": "جارٍ تحميل العاملين",
  "Fetching the workers in this workspace.": "يتم جلب العاملين في مساحة العمل.",
  "Worker not found": "العامل غير موجود",
  "This worker may have been deleted or belongs to another workspace.":
    "ربما تم حذف هذا العامل أو أنه يتبع مساحة عمل أخرى.",
  "No knowledge sources linked": "لا توجد مصادر معرفة مرتبطة",
  "Attach documents and collections from the Knowledge Center once they are available.":
    "اربط المستندات والمجموعات من مركز المعرفة عند توفرها.",
  "No memory stores linked": "لا توجد مخازن ذاكرة مرتبطة",
  "Short and long term memory policies for this worker will be configured here.":
    "ستُضبط سياسات الذاكرة القصيرة والطويلة لهذا العامل هنا.",
  "No tools enabled": "لا توجد أدوات مفعّلة",
  "Grant this worker access to the tools it may call during a run.":
    "امنح هذا العامل صلاحية استخدام الأدوات أثناء التشغيل.",
  "No integrations connected": "لا توجد تكاملات متصلة",
  "Connect workspace integrations so this worker can operate inside your stack.":
    "اربط تكاملات مساحة العمل ليعمل هذا العامل ضمن منظومتك.",
  "No voice profile": "لا يوجد ملف صوتي",
  "Assign a voice profile once the Voice Center is configured for this workspace.":
    "عيّن ملفاً صوتياً بعد إعداد مركز الصوت لمساحة العمل.",
  "Inheriting workspace permissions": "يرث صلاحيات مساحة العمل",
  "Per-worker permission overrides will be managed here alongside workspace roles.":
    "ستُدار استثناءات صلاحيات كل عامل هنا إلى جانب أدوار مساحة العمل.",
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
