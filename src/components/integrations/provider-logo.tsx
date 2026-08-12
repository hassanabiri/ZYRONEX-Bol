import { useState } from "react";

import { cn } from "@/lib/utils";
import type { ProviderDefinition } from "@/lib/integrations/catalog";

/**
 * Real brand marks for known providers (simple-icons CDN), with a graceful
 * fallback to the provider's existing lucide icon. Presentation only.
 */
const BRAND_SLUGS: Record<string, string> = {
  whatsapp: "whatsapp",
  telegram: "telegram",
  messenger: "messenger",
  instagram: "instagram",
  facebook_pages: "facebook",
  tiktok: "tiktok",
  slack: "slack",
  discord: "discord",
  gmail: "gmail",
  outlook: "maildotru",
  microsoft_365: "microsoft",
  google_workspace: "google",
  zoom: "zoom",
  google_meet: "googlemeet",
  shopify: "shopify",
  woocommerce: "woocommerce",
  magento: "magento",
  opencart: "opencart",
  stripe: "stripe",
  graphql: "graphql",
  google_drive: "googledrive",
  s3: "amazonwebservices",
  postgres: "postgresql",
  salesforce: "salesforce",
  hubspot: "hubspot",
  openai_compatible: "openai",
};

export function ProviderLogo({
  provider,
  className,
}: {
  provider: Pick<ProviderDefinition, "id" | "name">;
  className?: string;
}) {
  const slug = BRAND_SLUGS[provider.id];
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        "icon-chip size-10 shrink-0 overflow-hidden rounded-xl bg-background/60",
        className,
      )}
    >
      {slug && !failed ? (
        <img
          src={`https://cdn.simpleicons.org/${slug}`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          width={20}
          height={20}
          className="size-5 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-sm font-bold uppercase">{provider.name.slice(0, 2)}</span>
      )}
    </span>
  );
}
