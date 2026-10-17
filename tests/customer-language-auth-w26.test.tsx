import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
const m=vi.hoisted(()=>({signin:vi.fn(),request:vi.fn(),reset:vi.fn(),token:"synthetic-reset-token",push:vi.fn()}));
vi.mock("@/lib/auth-client",()=>({LOGIN_NEXT_STORAGE_KEY:"next",signIn:{email:m.signin},authClient:{requestPasswordReset:m.request,resetPassword:m.reset}}));
vi.mock("@/app/login/actions",()=>({getPostLoginDestination:async()=>"/account"}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.push,refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams({token:m.token})}));
import { LoginForm } from "@/app/login/login-form";
import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";
import { credentialLanguageLink } from "@/domains/language/auth-email";
beforeEach(()=>{cleanup();vi.clearAllMocks();m.token="synthetic-reset-token";});
describe.each(["en","es"] as const)("W-26 secure credential UI in %s",language=>{
 it("keeps provider sign-in failure localized without changing authentication",async()=>{
  m.signin.mockResolvedValue({error:{message:"Provider technical message"}});
  render(<CustomerLanguageProvider language={language}><LoginForm/></CustomerLanguageProvider>);
  fireEvent.change(screen.getByLabelText(language==="es"?"Correo electrónico":"Email"),{target:{value:"synthetic@example.test"}});
  fireEvent.change(screen.getByLabelText(language==="es"?"Contraseña":"Password"),{target:{value:"TestOnly12345"}});
  fireEvent.click(screen.getByRole("button",{name:language==="es"?"Iniciar sesión":"Log in"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain(language==="es"?"no coinciden":"Provider technical message"));
  expect(m.signin).toHaveBeenCalledWith({email:"synthetic@example.test",password:"TestOnly12345"});expect(m.push).not.toHaveBeenCalled();
 });
 it("preserves neutral account-existence response and secure reset destination",async()=>{
  m.request.mockResolvedValue({});
  render(<CustomerLanguageProvider language={language}><ForgotPasswordForm/></CustomerLanguageProvider>);
  fireEvent.change(screen.getByLabelText(language==="es"?"Correo electrónico":"Email"),{target:{value:"unknown@example.test"}});
  fireEvent.click(screen.getByRole("button",{name:language==="es"?"Enviar enlace de recuperación":"Send reset link"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain(language==="es"?"Si ese correo tiene una cuenta":"If that email has an account"));
  expect(m.request).toHaveBeenCalledWith({email:"unknown@example.test",redirectTo:language==="es"?"/reset-password?language=es":"/reset-password"});
 });
 it("rejects mismatched credentials before calling the provider",()=>{
  render(<CustomerLanguageProvider language={language}><ResetPasswordForm/></CustomerLanguageProvider>);
  fireEvent.change(screen.getByLabelText(language==="es"?"Contraseña nueva":"New password"),{target:{value:"LongEnough123"}});
  fireEvent.change(screen.getByLabelText(language==="es"?"Confirme la contraseña nueva":"Confirm new password"),{target:{value:"Different123"}});
  fireEvent.click(screen.getByRole("button",{name:language==="es"?"Establecer contraseña":"Set password"}));
  expect(screen.getByRole("alert").textContent).toContain(language==="es"?"no coinciden":"don't match");expect(m.reset).not.toHaveBeenCalled();
 });
 it("renders expired-link recovery in the chosen language",()=>{
  m.token="";render(<CustomerLanguageProvider language={language}><ResetPasswordForm/></CustomerLanguageProvider>);
  expect(screen.getByRole("link").textContent).toBe(language==="es"?"Solicitar un enlace nuevo":"Request a new link");expect(m.reset).not.toHaveBeenCalled();
 });
});
it("retains the exact reset token and callback while carrying the credential language",()=>{
 const original="https://example.test/api/auth/reset-password/synthetic-token?callbackURL=%2Freset-password";
 expect(credentialLanguageLink(original,"en")).toBe(original);
 const result=new URL(credentialLanguageLink(original,"es"));
 expect(result.pathname).toBe("/api/auth/reset-password/synthetic-token");
 expect(result.searchParams.get("callbackURL")).toBe("https://example.test/reset-password?language=es");
});
