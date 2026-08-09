import type { SimulationResult } from "./simulation";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    businessSummary: { type: "string" },
    agents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          firstAction: { type: "string" },
        },
        required: ["key", "name", "role", "firstAction"],
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          actor: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          metric: { type: "string" },
        },
        required: ["actor", "title", "detail", "metric"],
      },
    },
    today: { type: "array", items: { type: "string" } },
    withZyronex: { type: "array", items: { type: "string" } },
    opportunity: { type: "string" },
    kpis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          delta: { type: "string" },
        },
        required: ["label", "value", "delta"],
      },
    },
    recommendedPlan: { type: "string" },
    planReason: { type: "string" },
    modules: { type: "array", items: { type: "string" } },
    integrations: { type: "array", items: { type: "string" } },
  },
  required: [
    "businessSummary",
    "agents",
    "timeline",
    "today",
    "withZyronex",
    "opportunity",
    "kpis",
    "recommendedPlan",
    "planReason",
    "modules",
    "integrations",
  ],
} as const;

type Input = {
  business: string;
  focus: string;
  details: string;
  scenario: string;
  language: "en" | "ar";
  mode: "simulation" | "solution";
};

function fallback(input: Input): SimulationResult {
  const ar = input.language === "ar";
  const b = input.business || (ar ? "نشاطك" : "your business");
  return {
    businessSummary: ar
      ? `محاكاة أولية لـ ${b} مع التركيز على ${input.focus}.`
      : `Initial simulation for ${b}, focused on ${input.focus}.`,
    agents: [
      { key: "executive", name: ar ? "المدير التنفيذي AI" : "AI Executive", role: ar ? "يفهم الصورة الكاملة ويقرر" : "Owns the full picture and decides", firstAction: ar ? "قراءة مؤشرات النشاط" : "Reads business signals" },
      { key: "sales", name: ar ? "المبيعات AI" : "AI Sales", role: ar ? "يدير فرص البيع" : "Runs pipeline and opportunities", firstAction: ar ? "التقاط عميل جديد" : "Captures a new lead" },
      { key: "marketing", name: ar ? "التسويق AI" : "AI Marketing", role: ar ? "يدير الحملات والمحتوى" : "Runs campaigns and content", firstAction: ar ? "اقتراح حملة" : "Proposes a campaign" },
      { key: "support", name: ar ? "خدمة العملاء AI" : "AI Customer Success", role: ar ? "يرد ويتابع الطلبات" : "Answers and follows up", firstAction: ar ? "الرد على استفسار" : "Answers an enquiry" },
      { key: "operations", name: ar ? "العمليات AI" : "AI Operations", role: ar ? "يراقب المهام والتنبيهات" : "Watches tasks and alerts", firstAction: ar ? "فتح مهمة تشغيلية" : "Opens an operational task" },
      { key: "analyst", name: ar ? "المحلل AI" : "AI Analyst", role: ar ? "يحلل البيانات ويستخرج القرارات" : "Turns data into decisions", firstAction: ar ? "توليد Insight" : "Generates an insight" },
    ],
    timeline: [
      { actor: ar ? "خدمة العملاء AI" : "AI Customer Success", title: ar ? "وصل عميل جديد" : "New customer arrived", detail: ar ? "استفسار عن التوفر والتوصيل، تم الرد خلال ثوانٍ." : "Availability and delivery question answered in seconds.", metric: ar ? "زمن الرد 4 ث" : "Reply 4s" },
      { actor: ar ? "المبيعات AI" : "AI Sales", title: ar ? "تم اكتشاف فرصة بيع" : "Sales opportunity detected", detail: ar ? "نية شراء عالية، تم تصنيف الفرصة." : "High purchase intent, opportunity scored.", metric: ar ? "احتمال 72%" : "72% likely" },
      { actor: "CRM", title: ar ? "تم تحديث العميل في CRM" : "CRM record updated", detail: ar ? "بيانات موحدة بدون إدخال يدوي." : "Unified record with no manual entry.", metric: ar ? "0 إدخال يدوي" : "0 manual entry" },
      { actor: ar ? "العمليات AI" : "AI Operations", title: ar ? "تم إنشاء متابعة تلقائية" : "Automatic follow-up created", detail: ar ? "مهمة مجدولة مع تنبيه للفريق." : "Scheduled task with a team alert.", metric: ar ? "خلال 24 س" : "within 24h" },
      { actor: ar ? "المحلل AI" : "AI Analyst", title: ar ? "ظهر Insight للإدارة" : "Insight surfaced to management", detail: ar ? "قناة الواتساب تحقق أعلى تحويل هذا الأسبوع." : "WhatsApp is converting best this week.", metric: ar ? "+18% تحويل" : "+18% conversion" },
    ],
    today: ar
      ? ["أدوات منفصلة", "بيانات موزعة", "متابعة يدوية", "قرارات متأخرة"]
      : ["Separate tools", "Scattered data", "Manual follow-up", "Late decisions"],
    withZyronex: ar
      ? ["بيئة تشغيل موحدة", "وكلاء AI مترابطون", "بيانات موحدة", "أتمتة للعمليات", "Insights فورية", "تنفيذ مستمر"]
      : ["One operating layer", "Connected AI workers", "Unified data", "Automated operations", "Instant insights", "Continuous execution"],
    opportunity: ar
      ? "أكبر فرصة أمام نشاطك هي توحيد المبيعات وخدمة العملاء والعمليات في طبقة تشغيل واحدة."
      : "Your biggest opportunity is unifying sales, service and operations into one operating layer.",
    kpis: [
      { label: ar ? "زمن الاستجابة" : "Response time", value: ar ? "ثوانٍ" : "seconds", delta: "-90%" },
      { label: ar ? "الفرص الملتقطة" : "Captured opportunities", value: "+34%", delta: "▲" },
      { label: ar ? "العمل اليدوي" : "Manual work", value: "-60%", delta: "▼" },
    ],
    recommendedPlan: "Growth",
    planReason: ar
      ? "حجم العمليات يحتاج وكلاء غير محدودين وتكاملات كاملة مع تتبع الاستهلاك."
      : "Your volume needs unlimited workers, full integrations and metered usage tracking.",
    modules: ["AI Sales", "AI Marketing", "AI Customer Service", "AI Operations", "Analytics"],
    integrations: ["WhatsApp", "CRM", "Email", "Payments"],
  };
}

/** Calls the Google Gemini API directly with the GEMINI_API_KEY secret. */
export async function generateSimulation(input: Input): Promise<{ result: SimulationResult; live: boolean }> {
  const { generateGeminiText } = await import("@/lib/ai/gemini.server");

  const ar = input.language === "ar";
  const instructions = [
    "You are the ZYRONEX AI demo engine on the public website.",
    "ZYRONEX is an AI business operating platform: AI workers, workflow engine, knowledge, memory, voice, integrations, billing and governance.",
    input.mode === "solution"
      ? "Design a tailored ZYRONEX configuration for the described business (AI Solution Builder)."
      : "Build a live simulation of how ZYRONEX would operate inside the described business.",
    "Never say a human will contact the customer. Never mention sales staff, meetings or calls.",
    "Return json matching the schema. 5-6 agents, 5-6 timeline steps, 3-4 kpis, 4-6 modules, 3-6 integrations.",
    "Timeline steps must read as a real chain of operational events, concrete to this business.",
    "recommendedPlan must be one of: Starter, Growth, Enterprise.",
    ar ? "Write every value in Arabic." : "Write every value in English.",
  ].join(" ");

  const prompt = [
    `Business type: ${input.business}`,
    `Focus area: ${input.focus}`,
    `Scenario: ${input.scenario}`,
    `Customer own words: ${input.details || "(none)"}`,
  ].join("\n");

  try {
    const text = await generateGeminiText({
      system: instructions,
      turns: [{ role: "user", content: prompt }],
      jsonSchema: SCHEMA,
      maxOutputTokens: 4096,
    });
    if (!text) return { result: fallback(input), live: false };

    const parsed = JSON.parse(text) as SimulationResult;
    if (!parsed.agents?.length || !parsed.timeline?.length) return { result: fallback(input), live: false };
    return { result: parsed, live: true };
  } catch (error) {
    console.error("Gemini simulation failed", error);
    return { result: fallback(input), live: false };
  }
}

