import {
  Bot,
  ClipboardList,
  Coins,
  Gamepad2,
  Gift,
  History,
  Landmark,
  LayoutDashboard,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Store,
  Tags,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavigationGroup {
  label?: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  {
    items: [{ label: "Visão geral", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Jogos", href: "/catalogo/jogos", icon: Gamepad2 },
      { label: "Sublojas", href: "/catalogo/sublojas", icon: Store },
      { label: "Produtos", href: "/catalogo/produtos", icon: Tags },
    ],
  },
  {
    label: "Operação",
    items: [
      { label: "Pedidos", href: "/pedidos", icon: ClipboardList },
      { label: "Saldos", href: "/saldos", icon: Coins },
      { label: "Saques", href: "/saques", icon: Landmark },
    ],
  },
  {
    label: "Gestão",
    items: [
      { label: "Sorteios", href: "/sorteios", icon: Gift },
      { label: "Whitelist", href: "/whitelist", icon: ShieldCheck },
      { label: "Servidores", href: "/servidores", icon: UsersRound },
      { label: "Customização do bot", href: "/customizacao-bot", icon: Bot },
    ],
  },
  {
    label: "Sistema",
    items: [
      { label: "Auditoria", href: "/auditoria", icon: History },
      { label: "Configurações", href: "/configuracoes", icon: Settings2 },
    ],
  },
];

export const mobileNavigation: NavigationItem[] = [
  { label: "Início", href: "/", icon: LayoutDashboard },
  { label: "Produtos", href: "/catalogo/produtos", icon: PackageCheck },
  { label: "Pedidos", href: "/pedidos", icon: WalletCards },
];

export function isNavigationItemActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function getCurrentPageLabel(pathname: string) {
  const items = navigationGroups.flatMap((group) => group.items);
  const match = items
    .filter((item) => isNavigationItemActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.label ?? "Painel";
}
