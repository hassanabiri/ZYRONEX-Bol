import { Link } from "@tanstack/react-router";
import { siteFooter } from "@/lib/site/content";
import { useI18n } from "@/lib/i18n";

export function SiteFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2">
              <span className="brand-gradient flex size-8 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground">
                Z
              </span>
              <span className="font-display text-lg font-semibold">ZYRONEX</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("The AI business operating platform. Build, operate and govern your AI workforce from one workspace.")}
            </p>
          </div>

          {siteFooter.map((group) => (
            <div key={group.label}>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t(group.label)}</p>
              <ul className="mt-4 space-y-2.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t(item.title)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} ZYRONEX. {t("All rights reserved.")}</p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-foreground">{t("Privacy")}</Link>
            <Link to="/terms" className="hover:text-foreground">{t("Terms")}</Link>
            <Link to="/security" className="hover:text-foreground">{t("Security")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
