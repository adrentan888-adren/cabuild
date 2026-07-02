type SendVerificationInput = {
  email: string;
  code: string;
};

function apiKey() {
  return process.env.BREVO_API_KEY?.trim();
}

function senderEmail() {
  return process.env.BREVO_FROM_EMAIL?.trim() || "noreply@contentagent.tech";
}

function senderName() {
  return process.env.BREVO_FROM_NAME?.trim() || "ContentAgent";
}

export function hasBrevo() {
  return Boolean(apiKey());
}

export async function sendVerificationEmail({ email, code }: SendVerificationInput) {
  const key = apiKey();
  if (!key) throw new Error("BREVO_API_KEY is not configured.");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": key,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: senderName(), email: senderEmail() },
      to: [{ email }],
      subject: "Verify your ContentAgent account",
      htmlContent: `
        <html>
          <body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.5">
            <p>Your ContentAgent verification code is:</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
            <p>This code expires in 15 minutes.</p>
            <p>If you did not create this account, you can ignore this email.</p>
          </body>
        </html>
      `,
      textContent: `Your ContentAgent verification code is ${code}. This code expires in 15 minutes.`
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo verification email failed with HTTP ${res.status}: ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) as Record<string, unknown> : { ok: true };
}
