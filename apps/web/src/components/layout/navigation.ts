import {
  Megaphone,
  Bot,
  Boxes,
  ChartNoAxesCombined,
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
import { ROULETTE_AVAILABLE } from "@/lib/roulette/availability";
import { IS_GWSTORE } from "@/lib/brand";

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavigationGroup {
  label?: string;
  items: NavigationItem[];
}

/** A roleta roda só na GWStore, então as páginas dela não aparecem nas outras. */
const rouletteItems: NavigationItem[] =
  ROULETTE_AVAILABLE
    ? [
        { label: "Resgates", href: "/resgates", icon: PackageCheck },
        { label: "Roleta", href: "/metricas-roleta", icon: ChartNoAxesCombined },
      ]
    : [];

export const navigationGroups: NavigationGroup[] = [
  {
    items: [{ label: "Visão geral", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Jogos", href: "/catalogo/jogos", icon: Gamepad2 },
      { label: "Categorias", href: "/catalogo/sublojas", icon: Store },
      { label: "Produtos", href: "/catalogo/produtos", icon: Tags },
      { label: "Estoque por loja", href: "/estoque", icon: Boxes },
    ],
  },
  {
    label: "Operação",
    items: [
      { label: "Pedidos", href: "/pedidos", icon: ClipboardList },
      { label: "Entregas", href: "/entregas", icon: PackageCheck },
      ...(IS_GWSTORE ? [{ label: "Pagamentos Pix", href: "/pagamentos-pix", icon: WalletCards }] : []),
      { label: "Saldos", href: "/saldos", icon: Coins },
      { label: "Saques", href: "/saques", icon: Landmark },
    ],
  },
  {
    label: "Gestão",
    items: [
      { label: "Sorteios", href: "/sorteios", icon: Gift },
      ...rouletteItems,
      { label: "Whitelist", href: "/whitelist", icon: ShieldCheck },
      { label: "Servidores", href: "/servidores", icon: UsersRound },
      { label: "Customização do bot", href: "/customizacao-bot", icon: Bot },
      // A função que o lojista chama de "anunciar as vitrines" não existia como
      // palavra em lugar nenhum do menu: quem procurava não achava.
      { label: "Vitrines do Discord", href: "/configuracoes#vitrines", icon: Megaphone },
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

export function isNavigationItemActive(pathname: string, href: string, hash = "") {
  const [route, anchor] = href.split("#");
  const matches = route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);
  if (!matches) return false;
  if (anchor) return hash === `#${anchor}`;
  const anchoredPage = navigationGroups.some((group) => group.items.some((item) =>
    item.href === `${pathname}${hash}` && item.href.includes("#"),
  ));
  return !anchoredPage;
}

export function getCurrentPageLabel(pathname: string, hash = "") {
  const items = navigationGroups.flatMap((group) => group.items);
  const match = items
    .filter((item) => isNavigationItemActive(pathname, item.href, hash))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.label ?? "Painel";
}

export function filterNavigationGroups(query: string): NavigationGroup[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return navigationGroups;
  return navigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => terms.every((term) =>
      normalize(`${group.label ?? ""} ${item.label}`).includes(term),
    )),
  })).filter((group) => group.items.length > 0);
}
