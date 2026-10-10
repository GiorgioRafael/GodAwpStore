"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, MessageCircleMore } from "lucide-react";

import { INITIAL_CUSTOMER_AUTH_STATE, type CustomerEmailAuthMode, type CustomerEmailAuthState } from "@/lib/customer-auth-state";

type AuthMode = CustomerEmailAuthMode;
type FocusTarget = "tab" | "heading" | null;
type EmailAuthAction = (previousState: CustomerEmailAuthState, formData: FormData) => Promise<CustomerEmailAuthState>;

type CustomerAuthFormProps = {
  next: string;
  discordHref: string;
  googleHref: string;
  emailAction: EmailAuthAction;
  isCheckout?: boolean;
  feedback?: string | null;
  initialMode?: AuthMode;
};

const fieldClass = "min-h-12 w-full rounded-xl border border-white/15 bg-black/25 px-4 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/15 disabled:opacity-60 aria-invalid:border-rose-400";
const focusClass = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-300";

export function CustomerAuthForm({ initialMode = "login", ...props }: CustomerAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

  function changeMode(value: AuthMode, focus: FocusTarget = "tab") {
    setMode(value);
    setFocusTarget(focus);
  }

  return <CustomerAuthPanel key={mode} {...props} mode={mode} email={email} onEmailChange={setEmail}
    onModeChange={changeMode} focusTarget={focusTarget} />;
}

function CustomerAuthPanel({ mode, email, onEmailChange, onModeChange, focusTarget, next, discordHref, googleHref,
  emailAction, isCheckout = false, feedback = null }: Omit<CustomerAuthFormProps, "initialMode"> & {
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
      : isCheckout ? "Entre com Google, Discord ou email para concluir a compra."
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
    <h1 id={`${id}-heading`} ref={heading} tabIndex={-1} className="mt-3 text-center text-2xl font-semibold tracking-tight outline-none">{title}</h1>
    <p className="mt-3 text-center text-sm leading-6 text-white/60">{description}</p>
    {feedback ? <p role="alert" className="mt-5 rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/5 p-4 text-sm leading-6 text-white/80">{feedback}</p> : null}
    {!forgot && !reset ? <>
      <div role="tablist" aria-label="Acesso à sua conta" className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/25 p-1">
        {(["login", "signup"] as const).map(value => <button key={value} type="button" role="tab"
          id={`${id}-${value}-tab`} aria-selected={mode === value} aria-controls={`${id}-panel`}
          tabIndex={mode === value ? 0 : -1} ref={mode === value ? activeTab : undefined} disabled={pending}
          onKeyDown={tabKeyboard} onClick={() => onModeChange(value)}
          className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${focusClass} ${mode === value ? "bg-white/10 text-white shadow-sm" : "text-white/50 hover:text-white"}`}>
          {value === "login" ? "Entrar" : "Criar conta"}
        </button>)}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link href={googleHref} prefetch={false} aria-label="Continuar com Google" className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.04] px-3 text-sm font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[.08] ${focusClass}`}>
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.6Z" /><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.6A6 6 0 0 1 12 6Z" /></svg>
          Google
        </Link>
        <Link href={discordHref} prefetch={false} aria-label="Continuar com Discord" className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#5865f2]/45 bg-[#5865f2]/10 px-3 text-sm font-semibold text-white transition-colors hover:border-[#5865f2]/70 hover:bg-[#5865f2]/20 ${focusClass}`}>
          <MessageCircleMore aria-hidden="true" className="size-5 shrink-0" />Discord
        </Link>
      </div>
      <div className="my-5 flex items-center gap-3 text-xs text-white/40"><span className="h-px flex-1 bg-white/10" />ou use seu email<span className="h-px flex-1 bg-white/10" /></div>
    </> : null}
    <form action={formAction} aria-busy={pending} role={forgot || reset ? undefined : "tabpanel"}
      id={`${id}-panel`} aria-labelledby={forgot || reset ? `${id}-heading` : `${id}-${mode}-tab`} className={forgot || reset ? "mt-6" : ""}>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      <fieldset disabled={pending} className="space-y-4">
        {signup ? <div>
          <label htmlFor={`${id}-name`} className="mb-2 block text-sm font-medium text-white/80">Seu nome</label>
          <input id={`${id}-name`} name="displayName" type="text" autoComplete="name" required minLength={2} maxLength={60}
            value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Como podemos te chamar?"
            aria-invalid={Boolean(state.fieldErrors?.displayName)} aria-describedby={state.fieldErrors?.displayName ? `${id}-name-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.displayName ? <p id={`${id}-name-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.displayName}</p> : null}
        </div> : null}
        {!reset ? <div>
          <label htmlFor={`${id}-email`} className="mb-2 block text-sm font-medium text-white/80">Email</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254}
            value={email} onChange={event => onEmailChange(event.target.value)} placeholder="voce@exemplo.com"
            aria-invalid={Boolean(state.fieldErrors?.email)} aria-describedby={state.fieldErrors?.email ? `${id}-email-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.email ? <p id={`${id}-email-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.email}</p> : null}
        </div> : null}
        {!forgot ? <div>
          <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor={`${id}-password`} className="text-sm font-medium text-white/80">Senha</label>
            {!passwordMode ? <button type="button" onClick={() => onModeChange("forgot", "heading")} className={`rounded text-xs text-fuchsia-300 transition-colors hover:text-fuchsia-200 ${focusClass}`}>Esqueci minha senha</button> : null}
          </div>
          <div className="relative">
            <input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete={passwordMode ? "new-password" : "current-password"}
              required minLength={passwordMode ? 8 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}
              placeholder={passwordMode ? "Crie uma senha" : "Sua senha"} aria-invalid={Boolean(state.fieldErrors?.password)}
              aria-describedby={state.fieldErrors?.password ? `${id}-password-error` : passwordMode ? `${id}-password-help` : undefined} className={`${fieldClass} pr-12`} />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}
              className={`absolute inset-y-0 right-1 grid w-10 place-items-center rounded-lg text-white/50 hover:text-white ${focusClass}`}>
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
          {state.fieldErrors?.password ? <p id={`${id}-password-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.password}</p>
            : passwordMode ? <p id={`${id}-password-help`} className="mt-2 text-xs text-white/40">Use pelo menos 8 caracteres.</p> : null}
        </div> : null}
        {passwordMode ? <div>
          <label htmlFor={`${id}-confirm-password`} className="mb-2 block text-sm font-medium text-white/80">Confirmar senha</label>
          <input id={`${id}-confirm-password`} name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required maxLength={128}
            value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repita sua senha"
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} aria-describedby={state.fieldErrors?.confirmPassword ? `${id}-confirm-password-error` : undefined} className={fieldClass} />
          {state.fieldErrors?.confirmPassword ? <p id={`${id}-confirm-password-error`} className="mt-2 text-xs text-rose-300">{state.fieldErrors.confirmPassword}</p> : null}
        </div> : null}
        {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm leading-6 ${state.status === "error" ? "border-rose-400/25 bg-rose-400/5 text-rose-200" : "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"}`}>{state.message}</p> : null}
        <button type="submit" disabled={pending} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-400 disabled:cursor-wait disabled:opacity-60 ${focusClass}`}>
          {pending ? <><LoaderCircle size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{reset ? "Salvando..." : forgot ? "Enviando..." : signup ? "Criando conta..." : "Entrando..."}</>
            : <>{reset ? "Salvar nova senha" : forgot ? "Enviar link de recuperação" : signup ? "Criar conta com email" : "Entrar com email"}<ArrowRight size={17} aria-hidden="true" /></>}
        </button>
        {forgot ? <button type="button" onClick={() => onModeChange("login", "heading")} className={`min-h-10 w-full rounded-lg text-sm text-white/60 transition-colors hover:text-white ${focusClass}`}>Voltar para entrar</button> : null}
      </fieldset>
    </form>
  </>;
}
