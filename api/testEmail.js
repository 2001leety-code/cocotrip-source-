/**
 * GET /api/testEmail?to=2001leety@gmail.com&secret=<TEST_SECRET>
 *
 * Gmail SMTP 자격 증명/연결 진단용 임시 endpoint. 결제+플랜 흐름과 별개로
 * GMAIL_USER/GMAIL_APP_PASSWORD env가 실제로 SMTP 연결되는지 확인.
 *
 * 응답:
 *   { ok: true, messageId } — 메일 정상 발송됨
 *   { ok: false, error, code } — 실패 + 정확한 에러 메시지 (Auth 거부, 비밀번호
 *     틀림, 2FA 미활성, 등)
 *
 * 보안: secret 쿼리 파라미터로 admin만 호출 가능 (TEST_SECRET env 또는 admin 이메일).
 * 진단 끝나면 제거 권장.
 */
import nodemailer from 'nodemailer';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const ADMIN_EMAILS = ['2001leety@gmail.com', 'cocotripkr@gmail.com'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }

  const to = (req.query?.to || '').toString().trim();
  if (!to || !to.includes('@')) {
    res.status(400).json({ ok: false, error: 'to query param required (valid email)' });
    return;
  }

  // Light auth — recipient must be one of admin emails (스팸 방지)
  if (!ADMIN_EMAILS.includes(to.toLowerCase())) {
    res.status(403).json({ ok: false, error: 'recipient must be admin email' });
    return;
  }

  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();

  // 1단계: env 존재 확인
  if (!gmailUser) {
    res.status(500).json({ ok: false, error: 'GMAIL_USER env not set', code: 'NO_USER' });
    return;
  }
  if (!gmailPass) {
    res.status(500).json({ ok: false, error: 'GMAIL_APP_PASSWORD env not set', code: 'NO_PASS' });
    return;
  }

  // 2단계: SMTP 연결 + 메일 발송 시도
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    });

    // SMTP 연결만 검증 (verify) — 실제 메일 발송 전에 auth 통과 여부만 확인
    await transporter.verify();

    // 실제 발송
    const info = await transporter.sendMail({
      from: `"CocoTrip Diagnostic" <${gmailUser}>`,
      to,
      subject: '[CocoTrip Test] SMTP Diagnostic — ' + new Date().toISOString(),
      text: 'This is a diagnostic email from /api/testEmail. If you receive it, GMAIL env vars are correctly configured.',
      html: '<p>This is a <strong>diagnostic email</strong> from <code>/api/testEmail</code>.</p><p>If you receive it, GMAIL env vars are correctly configured.</p>',
    });

    res.status(200).json({
      ok: true,
      messageId: info.messageId,
      response: info.response,
      gmailUser,
      passwordLength: gmailPass.length,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || 'SMTP_ERROR',
      command: err.command || null,
      responseCode: err.responseCode || null,
      gmailUser,
      passwordLength: gmailPass.length,
    });
  }
}
