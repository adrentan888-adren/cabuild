import { Suspense } from "react";
import VerifyEmailForm from "./VerifyEmailForm";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="loading">Loading verification...</div>}>
      <VerifyEmailForm />
    </Suspense>
  );
}
