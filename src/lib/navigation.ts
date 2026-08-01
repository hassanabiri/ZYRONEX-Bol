import {
  LayoutDashboard,
  Building2,
  Bot,
  Workflow,
  BookOpen,
  Brain,
  AudioLines,
  Plug,
  Server,
  CreditCard,
  Code2,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  to: string;
  icon: LucideIcon;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { title: "Workspace", to: "/workspace", icon: Building2 },
    ],
  },
  {
    label: "Build",
    items: [
      { title: "Agents", to: "/agents", icon: Bot },
      { title: "Workflow", to: "/workflow", icon: Workflow },
      { title: "Knowledge", to: "/knowledge", icon: BookOpen },
      { title: "Memory", to: "/memory", icon: Brain },
      { title: "Voice", to: "/voice", icon: AudioLines },
    ],
  },
  {
    label: "Operate",
    items: [
      { title: "Integrations", to: "/integrations", icon: Plug },
      { title: "Resources", to: "/resources", icon: Server },
      { title: "Billing", to: "/billing", icon: CreditCard },
    ],
  },
  {
    label: "Platform",
    items: [
      { title: "Developer", to: "/developer", icon: Code2 },
      { title: "Administration", to: "/administration", icon: ShieldCheck },
      { title: "Settings", to: "/settings", icon: Settings },
    ],
  },
];
