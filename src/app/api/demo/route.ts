import { cookies } from "next/headers";
import {
  appOrigin,
  cookieName,
  services,
  json,
  route,
  write,
} from "../../../server/runtime.ts";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    write(request);
    const jar = await cookies();
    const existing = jar.get(cookieName)?.value;
    if (existing && (await services().demo.resolve(existing)))
      return json({ ok: true });
    const session = await services().demo.create();
    jar.set(cookieName, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: appOrigin.startsWith("https:"),
      path: "/",
      expires: session.expiresAt,
    });
    return json({ ok: true });
  });
}
export async function DELETE(request: Request) {
  return route(async () => {
    write(request);
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (token) await services().demo.revoke(token);
    jar.delete(cookieName);
    return json({ ok: true });
  });
}
