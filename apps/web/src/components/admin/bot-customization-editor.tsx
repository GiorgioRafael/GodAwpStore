"use client";

import { useActionState, useId, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleHelp,
  Hash,
  LoaderCircle,
  PackageSearch,
  Palette,
  ReceiptText,
  RotateCcw,
  Save,
  Store,
  TicketCheck,
} from "lucide-react";

import { saveBotMessageCustomizationAction } from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { formatDateTime } from "@/components/admin/admin-format";
import {
  DiscordMessagePreview,
  type DiscordPreviewScenario,
} from "@/components/admin/discord-message-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Textarea } from "@/components/ui/form-field";
import {
  BOT_MESSAGE_FIELD_LIMITS,
  BOT_MESSAGE_TOKEN_ALLOWLIST,
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "@/lib/bot/message-customization";

type ConfigSection = Exclude<keyof BotMessageCustomization, "version">;
type EditorSectionId = "storefront" | "product" | "quantity" | "order" | "helpError" | "ticket";

type FieldDefinition = {
  section: ConfigSection;
  key: string;
  label: string;
  maxLength: number;
  description?: string;
  multiline?: boolean;
  tall?: boolean;
  tokens?: string[];
};

type FieldGroup = {
  title: string;
  description: string;
  fields: FieldDefinition[];
};

type EditorSection = {
  id: EditorSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  preview: DiscordPreviewScenario;
  groups: FieldGroup[];
};

const f = (
  section: ConfigSection,
  key: string,
  label: string,
  maxLength: number,
  options: Omit<FieldDefinition, "section" | "key" | "label" | "maxLength" | "tokens"> = {},
): FieldDefinition => {
  const path = `${section}.${key}`;
  const configuredLimit = BOT_MESSAGE_FIELD_LIMITS[path as keyof typeof BOT_MESSAGE_FIELD_LIMITS];
  const allowedTokens = BOT_MESSAGE_TOKEN_ALLOWLIST[path] ?? [];
  return {
    section,
    key,
    label,
    ...options,
    maxLength: configuredLimit ?? maxLength,
    tokens: allowedTokens.length ? allowedTokens.map((token) => `{${token}}`) : undefined,
  };
};

const EDITOR_SECTIONS: EditorSection[] = [
  {
    id: "storefront",
    label: "Vitrine",
    description: "Mensagem pública com o catálogo e o seletor de produtos.",
    icon: Store,
    preview: "storefront",
    groups: [
      {
        title: "Cabeçalho",
        description: "Título e contexto mostrados no início da vitrine.",
        fields: [
          f("storefront", "title", "Título principal", 256),
          f("storefront", "paginatedTitle", "Título com paginação", 256),
          f("storefront", "subtitle", "Subtítulo", 256),
        ],
      },
      {
        title: "Apresentação",
        description: "Textos que explicam a compra antes da lista de produtos.",
        fields: [
          f("storefront", "welcome", "Boas-vindas", 1_000),
          f("storefront", "catalogText", "Apresentação do catálogo", 1_000),
          f("storefront", "privacyText", "Aviso de privacidade", 1_000),
          f("storefront", "paymentText", "Texto de pagamento", 1_000),
          f("storefront", "prompt", "Chamada para escolher", 1_000),
        ],
      },
      {
        title: "Seletor e catálogo vazio",
        description: "Rótulos do menu e textos usados quando não há produtos ativos.",
        fields: [
          f("storefront", "selectLabel", "Rótulo do seletor", 100),
          f("storefront", "selectPlaceholder", "Placeholder do seletor", 150),
          f("storefront", "emptyTitle", "Título sem produtos", 256),
          f("storefront", "emptyText", "Mensagem sem produtos", 1_000),
          f("storefront", "emptyHint", "Orientação sem produtos", 1_000),
        ],
      },
    ],
  },
  {
    id: "product",
    label: "Produto",
    description: "Detalhes privados mostrados após selecionar um produto.",
    icon: PackageSearch,
    preview: "product",
    groups: [
      {
        title: "Identidade do produto",
        description: "Cabeçalho montado com os dados do catálogo.",
        fields: [
          f("product", "title", "Título", 256),
          f("product", "subtitle", "Subtítulo", 256),
          f("product", "selectedText", "Confirmação da escolha", 1_000),
        ],
      },
      {
        title: "Preço e disponibilidade",
        description: "Informações dinâmicas sobre valor, estoque e mínimo de compra.",
        fields: [
          f("product", "priceText", "Preço unitário", 1_000),
          f("product", "stockText", "Estoque", 1_000),
          f("product", "minimumText", "Mínimo de pagamento", 1_000),
          f("product", "invalidPriceText", "Preço inválido", 1_000),
          f("product", "insufficientStockText", "Estoque abaixo do mínimo", 1_000),
          f("product", "outOfStockText", "Produto esgotado", 1_000),
        ],
      },
      {
        title: "Compra",
        description: "Entrega, privacidade e ação disponível para o cliente.",
        fields: [
          f("product", "deliveryText", "Texto de entrega", 1_000),
          f("product", "privacyText", "Texto de privacidade", 1_000),
          f("product", "buttonLabel", "Botão de quantidade", 80),
        ],
      },
    ],
  },
  {
    id: "quantity",
    label: "Quantidade",
    description: "Modal e respostas usadas ao escolher a quantidade.",
    icon: Hash,
    preview: "quantity",
    groups: [
      {
        title: "Modal",
        description: "Título, rótulo e orientação do campo numérico.",
        fields: [
          f("quantity", "modalTitle", "Título do modal", 45),
          f("quantity", "inputLabel", "Rótulo do campo", 45),
          f("quantity", "inputPlaceholder", "Placeholder", 100),
        ],
      },
      {
        title: "Indisponibilidade",
        description: "Respostas privadas quando não é possível continuar.",
        fields: [
          f("quantity", "unavailableText", "Produto indisponível", 1_000),
          f("quantity", "invalidPriceText", "Preço inválido", 1_000),
          f("quantity", "insufficientStockText", "Estoque insuficiente", 1_000),
        ],
      },
    ],
  },
  {
    id: "order",
    label: "Pedido / Pix",
    description: "Resumo do pedido e instruções para concluir o pagamento.",
    icon: ReceiptText,
    preview: "order",
    groups: [
      {
        title: "Cabeçalho",
        description: "Variações exibidas para um pedido novo ou já existente.",
        fields: [
          f("order", "createdTitle", "Título do novo pedido", 256),
          f("order", "duplicateTitle", "Título do pedido já registrado", 256),
          f("order", "subtitle", "Subtítulo", 256),
        ],
      },
      {
        title: "Rótulos do resumo",
        description: "Textos que acompanham os dados calculados do pedido.",
        fields: [
          f("order", "productLabel", "Produto", 120),
          f("order", "unitPriceLabel", "Preço unitário", 120),
          f("order", "subtotalLabel", "Subtotal", 120),
          f("order", "discountLabel", "Desconto", 120),
          f("order", "totalLabel", "Total", 120),
          f("order", "orderIdLabel", "ID do pedido", 120),
        ],
      },
      {
        title: "Pagamento e atendimento",
        description: "Status, chamada de pagamento e próximos passos.",
        fields: [
          f("order", "statusText", "Status", 1_000),
          f("order", "paymentPrompt", "Chamada para pagamento", 1_000),
          f("order", "paymentButtonLabel", "Botão de pagamento", 80),
          f("order", "ticketText", "Texto do ticket", 1_000),
          f("order", "privacyText", "Texto de privacidade", 1_000),
          f("order", "protectedText", "Texto de proteção", 1_000),
        ],
      },
    ],
  },
  {
    id: "helpError",
    label: "Ajuda / erros",
    description: "Comando de ajuda e respostas para falhas do fluxo.",
    icon: CircleHelp,
    preview: "help",
    groups: [
      {
        title: "Ajuda",
        description: "Conteúdo exibido pelo comando de ajuda do bot.",
        fields: [
          f("help", "title", "Título", 256),
          f("help", "subtitle", "Subtítulo", 256),
          f("help", "body", "Passo a passo", 4_000, { multiline: true, tall: true }),
        ],
      },
      {
        title: "Mensagem de erro",
        description: "Cabeçalho comum e orientação para tentar novamente.",
        fields: [
          f("error", "title", "Título", 256),
          f("error", "subtitle", "Subtítulo", 256),
          f("error", "retryText", "Orientação para tentar novamente", 1_000),
        ],
      },
      {
        title: "Erros específicos",
        description: "Resposta adequada para cada interrupção possível.",
        fields: [
          f("error", "invalidRequest", "Solicitação inválida", 1_000),
          f("error", "invalidQuantity", "Quantidade inválida", 1_000),
          f("error", "guildNotAuthorized", "Servidor não autorizado", 1_000),
          f("error", "productUnavailable", "Produto indisponível", 1_000),
          f("error", "outOfStock", "Sem estoque", 1_000),
          f("error", "insufficientStock", "Estoque insuficiente", 1_000),
          f("error", "quantityBelowMinimum", "Abaixo do mínimo", 1_000),
          f("error", "interactionConflict", "Interação já usada", 1_000),
          f("error", "storeUnavailable", "Loja temporariamente indisponível", 1_000),
          f("error", "productLoadFailure", "Falha ao carregar produto", 1_000),
          f("error", "purchaseFailure", "Falha ao criar pedido", 1_000),
          f("error", "outsideServer", "Compra fora do servidor", 1_000),
        ],
      },
    ],
  },
  {
    id: "ticket",
    label: "Ticket",
    description: "Mensagem criada após a confirmação do pagamento.",
    icon: TicketCheck,
    preview: "ticket",
    groups: [
      {
        title: "Boas-vindas do ticket",
        description: "Conteúdo do atendimento privado pós-pagamento.",
        fields: [
          f("ticket", "title", "Título", 256),
          f("ticket", "description", "Descrição", 1_000, { multiline: true }),
          f("ticket", "productLabel", "Rótulo do produto", 120),
          f("ticket", "quantityLabel", "Rótulo da quantidade", 120),
          f("ticket", "amountLabel", "Rótulo do valor", 120),
          f("ticket", "orderLabel", "Rótulo do pedido", 120),
        ],
      },
      {
        title: "Coleta do nick no jogo",
        description: "Orientação, botão e modal usados depois que o pagamento já foi confirmado.",
        fields: [
          f("ticket", "nicknamePromptText", "Orientação antes do botão", 1_000, {
            multiline: true,
          }),
          f("ticket", "nicknameButtonLabel", "Botão para informar o nick", 80),
          f("ticket", "nicknameModalTitle", "Título do modal de nick", 45),
          f("ticket", "nicknameInputLabel", "Rótulo do campo de nick", 45),
          f("ticket", "nicknameInputPlaceholder", "Placeholder do campo de nick", 100),
        ],
      },
      {
        title: "Respostas do nick",
        description: "Mensagens enviadas ao salvar, atualizar ou recusar o nick informado.",
        fields: [
          f("ticket", "nicknameSavedText", "Confirmação do nick recebido", 1_000, {
            multiline: true,
          }),
          f("ticket", "nicknameUpdatedText", "Confirmação do nick atualizado", 1_000, {
            multiline: true,
          }),
          f("ticket", "nicknameInvalidText", "Nick inválido", 1_000, { multiline: true }),
          f("ticket", "nicknameUnauthorizedText", "Usuário não autorizado", 1_000, {
            multiline: true,
          }),
          f("ticket", "nicknameUnavailableText", "Pedido indisponível", 1_000, {
            multiline: true,
          }),
        ],
      },
    ],
  },
];

interface BotCustomizationEditorProps {
  initialConfig: BotMessageCustomization;
  updatedAt: string | null;
}

export function BotCustomizationEditor({
  initialConfig,
  updatedAt,
}: BotCustomizationEditorProps) {
  const [config, setConfig] = useState<BotMessageCustomization>(() => cloneConfig(initialConfig));
  const [activeSectionId, setActiveSectionId] = useState<EditorSectionId>("storefront");
  const [previewScenario, setPreviewScenario] = useState<DiscordPreviewScenario>("storefront");
  const [mobileView, setMobileView] = useState<"editor" | "preview">("editor");
  const [restoredLocally, setRestoredLocally] = useState(false);
  const [state, formAction, pending] = useActionState(
    saveBotMessageCustomizationAction,
    initialAdminActionState,
  );
  const formId = useId();
  const serializedConfig = useMemo(() => JSON.stringify(config), [config]);
  const activeSection =
    EDITOR_SECTIONS.find((section) => section.id === activeSectionId) ?? EDITOR_SECTIONS[0];

  function selectSection(section: EditorSection) {
    setActiveSectionId(section.id);
    setPreviewScenario(section.preview);
  }

  function updateField(field: FieldDefinition, value: string) {
    setConfig((current) => ({
      ...current,
      [field.section]: {
        ...current[field.section],
        [field.key]: value,
      },
    }) as BotMessageCustomization);
    setRestoredLocally(false);
  }

  function appendToken(field: FieldDefinition, token: string) {
    const current = fieldValue(config, field);
    const separator = current.length > 0 && !current.endsWith(" ") ? " " : "";
    const next = `${current}${separator}${token}`;
    if (next.length <= field.maxLength) updateField(field, next);
  }

  function restoreDefaults() {
    setConfig(cloneConfig(DEFAULT_BOT_MESSAGE_CUSTOMIZATION));
    setRestoredLocally(true);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-1.5 xl:hidden">
        <button
          type="button"
          aria-pressed={mobileView === "editor"}
          onClick={() => setMobileView("editor")}
          className={cn(
            "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            mobileView === "editor"
              ? "bg-gold/[0.12] text-gold-bright"
              : "text-muted hover:text-foreground",
          )}
        >
          Editar mensagens
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "preview"}
          onClick={() => setMobileView("preview")}
          className={cn(
            "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            mobileView === "preview"
              ? "bg-[#5865f2]/15 text-[#c8ccff]"
              : "text-muted hover:text-foreground",
          )}
        >
          Ver prévia
        </button>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(22rem,.88fr)]">
        <form
          action={formAction}
          className={cn(mobileView === "editor" ? "block" : "hidden", "xl:block")}
        >
          <input type="hidden" name="config" value={serializedConfig} />
          <input type="hidden" name="expectedUpdatedAt" value={updatedAt ?? ""} />

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
                    <Palette aria-hidden="true" className="size-[18px]" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold tracking-tight">Editor de mensagens</h2>
                      <Badge tone="gold">Global</Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      Escolha uma etapa e personalize cada texto do fluxo.
                    </p>
                  </div>
                </div>
                {restoredLocally ? <Badge tone="warning">Padrões restaurados localmente</Badge> : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-5">
              <ActionFeedback state={state} />
              {fieldError(state, "config") ? (
                <p className="rounded-xl border border-danger/20 bg-danger/[0.05] px-3.5 py-3 text-xs leading-5 text-[#ffc0bd]">
                  {fieldError(state, "config")}
                </p>
              ) : null}

              <div className="grid gap-5 md:grid-cols-[12.5rem_minmax(0,1fr)]">
                <nav aria-label="Seções de mensagens" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:block md:space-y-1.5">
                  {EDITOR_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = section.id === activeSection.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => selectSection(section)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "border border-gold/25 bg-gold/[0.08] font-medium text-gold-bright"
                            : "border border-transparent text-muted hover:bg-white/[0.035] hover:text-foreground",
                        )}
                      >
                        <Icon aria-hidden="true" className={cn("size-4 shrink-0", active && "text-gold")} />
                        <span>{section.label}</span>
                      </button>
                    );
                  })}
                </nav>

                <div className="min-w-0 space-y-6">
                  <div className="border-b border-border pb-4">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {activeSection.label}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{activeSection.description}</p>
                  </div>

                  {activeSection.groups.map((group) => (
                    <fieldset key={group.title} className="space-y-4">
                      <legend className="text-sm font-semibold text-foreground">{group.title}</legend>
                      <p className="-mt-2 text-xs leading-5 text-muted">{group.description}</p>
                      <div className="space-y-5 rounded-xl border border-border bg-surface-muted p-4">
                        {group.fields.map((field) => {
                          const id = `${formId}-${field.section}-${field.key}`;
                          const value = fieldValue(config, field);
                          return (
                            <Field
                              key={`${field.section}.${field.key}`}
                              label={field.label}
                              htmlFor={id}
                              hint={`${value.length}/${field.maxLength}`}
                            >
                              {field.multiline ? (
                                <Textarea
                                  id={id}
                                  value={value}
                                  maxLength={field.maxLength}
                                  rows={field.tall ? 8 : 4}
                                  onChange={(event) => updateField(field, event.target.value)}
                                />
                              ) : (
                                <Input
                                  id={id}
                                  value={value}
                                  maxLength={field.maxLength}
                                  onChange={(event) => updateField(field, event.target.value)}
                                />
                              )}

                              {field.description ? (
                                <p className="text-xs leading-5 text-muted">{field.description}</p>
                              ) : null}

                              {field.tokens?.length ? (
                                <div className="flex flex-wrap items-center gap-1.5" aria-label={`Variáveis de ${field.label}`}>
                                  <span className="mr-1 text-[11px] text-muted">Variáveis:</span>
                                  {field.tokens.map((token) => (
                                    <button
                                      key={token}
                                      type="button"
                                      onClick={() => appendToken(field, token)}
                                      className="rounded-md border border-border-strong bg-surface px-1.5 py-1 font-mono text-[10px] text-gold-bright transition-colors hover:border-gold/45 hover:bg-gold/[0.06]"
                                      aria-label={`Adicionar ${token} em ${field.label}`}
                                    >
                                      {token}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </Field>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs leading-5 text-muted">
                <p>{updatedAt ? `Última atualização: ${formatDateTime(updatedAt)}` : "Ainda não atualizada"}</p>
                <p>Restaurar só altera o formulário; confirme em salvar para publicar.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={restoreDefaults} disabled={pending}>
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Restaurar padrões
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" className="size-4" />
                  )}
                  {pending ? "Salvando..." : "Salvar personalização"}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>

        <div
          className={cn(
            mobileView === "preview" ? "block" : "hidden",
            "xl:sticky xl:top-24 xl:block xl:self-start",
          )}
        >
          <DiscordMessagePreview
            config={config}
            scenario={previewScenario}
            onScenarioChange={setPreviewScenario}
          />
        </div>
      </div>
    </div>
  );
}

function fieldValue(config: BotMessageCustomization, field: FieldDefinition) {
  const section = config[field.section] as Record<string, string>;
  return section[field.key] ?? "";
}

function cloneConfig(config: BotMessageCustomization): BotMessageCustomization {
  return JSON.parse(JSON.stringify(config)) as BotMessageCustomization;
}
