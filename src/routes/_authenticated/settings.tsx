import { createFileRoute } from "@tanstack/react-router";
import { Bell, Lock, Palette, Settings, User } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings Center — ZYRONEX" },
      { name: "description", content: "Profile, workspace preferences, security and notification configuration." },
      { property: "og:title", content: "Settings Center — ZYRONEX" },
      { property: "og:description", content: "Profile, workspace preferences, security and notification configuration." },
    ],
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Profile", description: "Name, avatar and contact preferences.", icon: User },
    { title: "Security", description: "Sessions, MFA and password management.", icon: Lock },
    { title: "Notifications", description: "Delivery channels and alert thresholds.", icon: Bell },
    { title: "Appearance", description: "Theme, density and localization.", icon: Palette },
  ];

  return (
    <ModulePage
      title="Settings Center"
      description="Profile, workspace preferences, security and notification configuration."
      icon={Settings}
      capabilities={capabilities}
    />
  );
}
