"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, MessageCircleMore } from "lucide-react";

import { INITIAL_CUSTOMER_AUTH_STATE, type CustomerEmailAuthMode, type CustomerEmailAuthState } from "@/lib/customer-auth-state";
import type { CustomerAuthProviders } from "@/lib/customer-auth-providers";

type AuthMode = CustomerEmailAuthMode;
type FocusTarget = "tab" | "heading" | null;
type EmailAuthAction = (previousState: CustomerEmailAuthState, formData: FormData) => Promise<CustomerEmailAuthState>;

type CustomerAuthFormProps = {
  next: string;
  discordHref: string;
  googleHref: string;
  emailAction: EmailAuthAction;
  providers: CustomerAuthProviders;
  isCheckout?: boolean;
  feedback?: string | null;
  initialMode?: AuthMode;
};

// globals.css sets `* { border-color }` and `:focus-visible { outline }` outside any layer, so they beat
// Tailwind utilities; border colours and focus outlines here carry `!` to keep the store magenta.
const fieldClass = "min-h-12 w-full rounded-xl border border-[#746289]! bg-[#0b0710] px-4 text-base text-white outline-none! transition-colors placeholder:text-white/50 focus:border-[#ff4fc4]! focus:ring-[3px] focus:ring-[#ec009c]/25 disabled:opacity-60 aria-invalid:border-rose-400! sm:text-sm";
const focusClass = "focus-visible:outline-2 focus-visible:outline-offset-4! focus-visible:outline-[#ff9be3]!";
const display = "font-[family-name:var(--font-shop-display)]";
const labelClass = "text-sm font-medium text-white/85";
const providerClass = `flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${focusClass}`;

export function CustomerAuthForm({ initialMode = "login", ...props }: CustomerAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

  function changeMode(value: AuthMode, focus: FocusTarget = "tab") {
    setMode(value);
    setFocusTarget(focus);
  }

  if (!props.providers.email) {
    const hasProvider = props.providers.google || props.providers.discord;
    return <>
      <h1 className={`mt-3 text-center ${display} text-[26px] font-bold uppercase leading-[1.1] tracking-[0.01em] text-balance`}>
        {props.isCheckout ? "Entre para concluir a compra" : "Entre na sua conta"}</h1>
      <p className="mt-3 text-center text-sm leading-6 text-pretty text-white/65">
        {hasProvider ? "Escolha uma opção abaixo. Sua conta é criada no primeiro acesso para acompanhar pedidos e conversar com a loja."
          : "O acesso está temporariamente indisponível. Tente novamente em alguns instantes."}</p>
      {props.feedback ? <p role="alert" className="mt-5 rounded-xl border border-[#ec009c]/35! bg-[#ec009c]/10 p-4 text-sm leading-6 text-white/85">{props.feedback}</p> : null}
      <SocialAuthLinks providers={props.providers} googleHref={props.googleHref} discordHref={props.discordHref} />
    </>;
  }

  return <CustomerAuthPanel key={mode} {...props} mode={mode} email={email} onEmailChange={setEmail}
    onModeChange={changeMode} focusTarget={focusTarget} />;
}

function CustomerAuthPanel({ mode, email, onEmailChange, onModeChange, focusTarget, next, discordHref, googleHref,
  emailAction, providers, isCheckout = false, feedback = null }: Omit<CustomerAuthFormProps, "initialMode"> & {
  mode: AuthMode;
  email: string;
  onEmailChange: (value: string) => void;
  onModeChange: (mode: AuthMode, focus?: FocusTarget) => void;
  focusTarget: FocusTarget;
}) {
  const [state, formAction, pending] = useActionState(emailAction, INITIAL_CUSTOMER_AUTH_STATE);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const reset = mode === "reset";
  const passwordMode = signup || reset;
  const title = reset ? "Crie uma nova senha" : forgot ? "Recupere sua senha" : signup ? "Crie sua conta" : isCheckout ? "Entre para concluir a compra" : "Entre na sua conta";
  const description = reset ? "Escolha uma nova senha para acessar sua conta."
    : forgot ? "Informe seu email para receber o link de recuperação."
    : signup ? "Escolha como criar sua conta e acompanhe suas compras por aqui."
      : isCheckout ? "Acesse sua conta para concluir a compra."
        : "Acompanhe seus pedidos e converse com a loja em um só lugar.";

  useEffect(() => {
    if (focusTarget === "heading") heading.current?.focus();
    if (focusTarget === "tab") activeTab.current?.focus();
  }, [focusTarget]);

  function tabKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || pending) return;
    event.preventDefault();
    onModeChange(event.key === "Home" ? "login" : event.key === "End" ? "signup" : signup ? "login" : "signup");
  }

  return <>
    <h1 id={`${id}-heading`} ref={heading} tabIndex={-1} className={`mt-3 text-center ${display} text-[26px] font-bold uppercase leading-[1.1] tracking-[0.01em] text-balance outline-none!`}>{title}</h1>
    <p className="mt-3 text-center text-sm leading-6 text-pretty text-white/65">{description}</p>
    {feedback ? <p role="alert" className="mt-5 rounded-xl border border-[#ec009c]/35! bg-[#ec009c]/10 p-4 text-sm leading-6 text-white/85">{feedback}</p> : null}
    {!forgot && !reset ? <>
      <div role="tablist" aria-label="Acesso à sua conta" className="mt-6 grid grid-cols-2 gap-1 rounded-2xl border border-white/10! bg-black/30 p-1">
        {(["login", "signup"] as const).map(value => <button key={value} type="button" role="tab"
          id={`${id}-${value}-tab`} aria-selected={mode === value} aria-controls={`${id}-panel`}
          tabIndex={mode === value ? 0 : -1} ref={mode === value ? activeTab : undefined} disabled={pending}
          onKeyDown={tabKeyboard} onClick={() => onModeChange(value)}
          className={`min-h-11 rounded-xl px-3 ${display} text-sm font-semibold uppercase tracking-[0.06em] transition-colors disabled:opacity-60 ${focusClass} ${mode === value
            ? "bg-[#ec009c]/15 text-white shadow-[0_6px_18px_-8px_rgba(236,0,156,.7)] ring-1 ring-[#ec009c]/50 ring-inset"
            : "text-white/60 hover:bg-white/[.04] hover:text-white"}`}>
          {value === "login" ? "Entrar" : "Criar conta"}
        </button>)}
      </div>
      <SocialAuthLinks providers={providers} googleHref={googleHref} discordHref={discordHref} />
      {providers.google || providers.discord ? <div className="my-5 flex items-center gap-3 text-xs text-white/50"><span className="h-px flex-1 bg-white/10" />ou use seu email<span className="h-px flex-1 bg-white/10" /></div> : <div className="h-5" />}
    </> : null}
    <form action={formAction} aria-busy={pending} role={forgot || reset ? undefined : "tabpanel"}
      id={`${id}-panel`} aria-labelledby={forgot || reset ? `${id}-heading` : `${id}-${mode}-tab`} className={forgot || reset ? "mt-6" : ""}>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      <fieldset disabled={pending} className="space-y-4">
        {signup ? <div>
          <label htmlFor={`${id}-name`} className={`mb-2 block ${labelClass}`}>Seu nome</label>
          <input id={`${id}-name`} name="displayName" type="text" autoComplete="name" required minLength={2} maxLength={60}
            value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Como podemos te chamar?"
            aria-invalid={Boolean(state.fieldErrors?.displayName)} aria-describedby={state.fieldErrors?.displayName ? `${id}-name-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.displayName ? <p id={`${id}-name-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.displayName}</p> : null}
        </div> : null}
        {!reset ? <div>
          <label htmlFor={`${id}-email`} className={`mb-2 block ${labelClass}`}>Email</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254}
            value={email} onChange={event => onEmailChange(event.target.value)} placeholder="voce@exemplo.com"
            aria-invalid={Boolean(state.fieldErrors?.email)} aria-describedby={state.fieldErrors?.email ? `${id}-email-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.email ? <p id={`${id}-email-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.email}</p> : null}
        </div> : null}
        {!forgot ? <div>
          <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor={`${id}-password`} className={labelClass}>Senha</label>
            {!passwordMode ? <button type="button" onClick={() => onModeChange("forgot", "heading")} className={`relative rounded text-xs font-medium text-[#ff8fdc] transition-colors after:absolute after:-inset-x-2 after:-top-4 after:-bottom-2.5 after:content-[''] hover:text-[#ffc2ec] ${focusClass}`}>Esqueci minha senha</button> : null}
          </div>
          <div className="relative">
            <input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete={passwordMode ? "new-password" : "current-password"}
              required minLength={passwordMode ? 8 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}
              placeholder={passwordMode ? "Crie uma senha" : "Sua senha"} aria-invalid={Boolean(state.fieldErrors?.password)}
              aria-describedby={state.fieldErrors?.password ? `${id}-password-error` : passwordMode ? `${id}-password-help` : undefined} className={`${fieldClass} pr-12`} />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}
              className="absolute inset-y-0 right-1 grid w-10 place-items-center rounded-lg text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-[#ff9be3]!">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {state.fieldErrors?.password ? <p id={`${id}-password-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.password}</p>
            : passwordMode ? <p id={`${id}-password-help`} className="mt-2 text-xs text-white/55">Use pelo menos 8 caracteres.</p> : null}
        </div> : null}
        {passwordMode ? <div>
          <label htmlFor={`${id}-confirm-password`} className={`mb-2 block ${labelClass}`}>Confirmar senha</label>
          <input id={`${id}-confirm-password`} name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required maxLength={128}
            value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repita sua senha"
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} aria-describedby={state.fieldErrors?.confirmPassword ? `${id}-confirm-password-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.confirmPassword ? <p id={`${id}-confirm-password-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.confirmPassword}</p> : null}
        </div> : null}
        {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm leading-6 ${state.status === "error" ? "border-rose-400/30! bg-rose-400/10 text-rose-200" : "border-emerald-400/30! bg-emerald-400/10 text-emerald-200"}`}>{state.message}</p> : null}
        <button type="submit" disabled={pending} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#d6008f,#a8006a)] px-4 py-3 ${display} text-[15px] font-bold uppercase tracking-[0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_12px_30px_-12px_rgba(236,0,156,.9)] transition-[box-shadow,transform] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.32),0_16px_36px_-10px_rgba(236,0,156,1)] active:scale-[.985] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${focusClass}`}>
          {pending ? <><LoaderCircle size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{reset ? "Salvando..." : forgot ? "Enviando..." : signup ? "Criando conta..." : "Entrando..."}</>
            : <>{reset ? "Salvar nova senha" : forgot ? "Enviar link de recuperação" : signup ? "Criar conta com email" : "Entrar com email"}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        {forgot ? <button type="button" onClick={() => onModeChange("login", "heading")} className={`min-h-11 w-full rounded-lg text-sm text-white/70 transition-colors hover:text-white ${focusClass}`}>Voltar para entrar</button> : null}
      </fieldset>
    </form>
  </>;
}

function SocialAuthLinks({ providers, googleHref, discordHref }: Pick<CustomerAuthFormProps, "providers" | "googleHref" | "discordHref">) {
  if (!providers.google && !providers.discord) return null;
  return <div className={`mt-5 grid gap-3 ${providers.google && providers.discord ? "grid-cols-2" : "grid-cols-1"}`}>
    {providers.google ? <Link href={googleHref} prefetch={false} aria-label="Continuar com Google" className={`${providerClass} border-white! bg-white text-[#1f1f1f] hover:bg-[#f1eef3]`}>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.6Z" /><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.6A6 6 0 0 1 12 6Z" /></svg>Google
    </Link> : null}
    {providers.discord ? <Link href={discordHref} prefetch={false} aria-label="Continuar com Discord" className={`${providerClass} border-[#5865f2]! bg-[#5865f2] text-white hover:border-[#4752c4]! hover:bg-[#4752c4]`}>
      <MessageCircleMore aria-hidden="true" className="size-5 shrink-0" />Discord
    </Link> : null}
  </div>;
}
