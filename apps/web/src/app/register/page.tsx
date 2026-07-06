import type { Metadata } from "next";
import { RegisterClient } from "./register-client";

export const metadata: Metadata = {
  title: "注册",
};

export default function RegisterPage() {
  return <RegisterClient />;
}
