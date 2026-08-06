# Marketing Command Center — طبقة إدارة فوق وكلاء ZYRONEX

الوضع الحالي: "التسويق" موجود اليوم فقط كـ *غرض* للوكيل داخل AI Workers (`worker-options.ts`). لا توجد وحدة تسويق مستقلة. لذلك الخطة تضيف **طبقة تنسيق (Orchestration Layer)** فوق الوكلاء الحاليين — بدون حذف أي وظيفة، وبدون وكيل جديد، وبدون إعادة بناء أي صفحة.

## المبدأ المعماري
وكيل التسويق = *منسّق*. لا ينفّذ المحتوى بنفسه، بل يفتح مهام (Creative Tasks) تُسند إلى وكلاء موجودين، وتُنفَّذ عبر Execution Engine الحالي، وتُسجَّل في `activity_log` الحالي، وتستهلك من محرك الأرصدة الحالي (`credit_balances` / `credit_transactions` / `usage_records`).

```text
Marketing Center (جديد)
   ├─ Campaigns / Budgets / Approvals / Alerts   ← جداول جديدة
   ├─ Creative Studio (طلبات محتوى)              ← تسند إلى ai_workers الحالية
   └─ يقرأ: credit_balances, usage_records, invoices, executions (موجودة)
```

## التنفيذ على مراحل

### المرحلة 1 — الأساس (هذا السبرنت)
- جداول جديدة: `marketing_campaigns`, `campaign_budgets`, `creative_requests`, `credit_transfers`, `marketing_alerts`, `approval_requests`, `brand_profiles` — كلها معزولة بـ workspace_id + RLS + GRANT.
- خدمة `marketing-service.ts` + هوك `use-marketing.ts` بنفس نمط الخدمات الحالية.
- مسار `/marketing` وبند في القائمة الجانبية ضمن مجموعة Build.
- تبويبات: Command Center، Creative Studio، Credits، Budgets، Alerts، Governance.

### المرحلة 2 — الإبداع والأرصدة
- Creative Studio: 13 نوع محتوى (صورة، فيديو، ريلز، إعلان، لاندنغ، بريد، واتساب، SMS…) مع اختيار الوكيل المنفّذ، حالة التنفيذ، مدة التنفيذ، إعادة توليد، حفظ في مكتبة المحتوى (تُخزَّن كـ knowledge_documents).
- محفظة الأرصدة: متاح/مستخدم/متبقٍ، معدل الاستهلاك اليومي والشهري، تاريخ النفاد المتوقع (حساب من `usage_records`).
- التحويل بين الأرصدة مع معاينة (الرصيد الحالي/الناتج/النسبة/التكلفة) وسجل كامل.
- المتجر: باقات وأرصدة إضافية تُقرأ من `src/lib/billing/catalog.ts` الحالي وتُصدر فاتورة عبر `invoices` الموجود.

### المرحلة 3 — الذكاء والحوكمة
- AI CMO: تحليل الاستهلاك والأداء وإصدار توصيات (رصيد سينفد، فائض، إعادة توزيع، ترقية باقة) عبر Lovable AI — كل توصية تحمل السبب والأثر وزر تنفيذ.
- التوزيع الذكي للميزانية + ROI Intelligence + A/B Testing على مستوى الأصول الإبداعية.
- Approvals Engine متعدد المستويات، Campaign Timeline، وسجل تدقيق غير قابل للتعديل (append-only) — مربوط بمصفوفة الصلاحيات الحالية.

## ملاحظات تقنية
- لا تعديل على أي وحدة قائمة سوى إضافة سطر في `src/lib/navigation.ts`.
- كل النصوص تُضاف إلى `src/lib/i18n.tsx` عربي/إنجليزي.
- كل عملية حساسة (شراء، تحويل، تعديل ميزانية) تمر بـ approval + audit.
- لا منطق ذكاء وهمي: التوصيات تأتي من Lovable AI فعليًا، والتنفيذ الإبداعي يمر عبر الوكلاء.

## المطلوب منك
أبدأ بالمرحلة 1 الآن (قاعدة البيانات + المسار + الهيكل + Command Center)، ثم أكمل 2 و3 تباعًا.
