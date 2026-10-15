/**
 * İşlem e-postalarının gövdeleri.
 *
 * Her e-posta hem düz metin hem HTML taşır: HTML görüntüleyemeyen istemci ve
 * spam filtreleri düz metne bakar. Kullanıcıdan gelen her değer (klinik adı,
 * kişi adı) HTML'e KAÇIŞLI yazılır; klinik adını kiracı kendisi belirler.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface MailBody {
  body: string;
  html: string;
}

function layout(input: {
  heading: string;
  paragraphs: string[];
  cta: { label: string; link: string };
  footnote: string;
}): string {
  const p = input.paragraphs.map((text) => `<p style="margin:0 0 16px">${text}</p>`).join('');
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;color:#2b2b2b;line-height:1.5">` +
    `<h2 style="margin:0 0 12px">${input.heading}</h2>` +
    p +
    `<p style="margin:4px 0 20px"><a href="${escapeHtml(input.cta.link)}" style="background:#4a6b5d;color:#fff;` +
    `text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${input.cta.label}</a></p>` +
    `<p style="margin:0 0 8px;color:#777;font-size:13px">Düğme çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:<br>` +
    `<span style="word-break:break-all">${escapeHtml(input.cta.link)}</span></p>` +
    `<p style="margin:0;color:#777;font-size:13px">${input.footnote}</p></div>`
  );
}

export interface InvitationMailInput {
  link: string;
  ttlHours: number;
  /** Kliniğin adı; boşsa genel bir metin kullanılır. */
  tenantName?: string | undefined;
  /** Rolün Türkçe adı (`ROLE_BY_KEY[key].name`). */
  roleName?: string | undefined;
  /** Daveti gönderen kişinin adı; kiracı kurulumunda yok. */
  inviterName?: string | undefined;
}

export function invitationMail(input: InvitationMailInput): MailBody & { subject: string } {
  const clinic = input.tenantName?.trim() ? input.tenantName.trim() : undefined;
  const subject = clinic
    ? `${clinic} sizi Klinara'ya davet etti`
    : 'Klinara ekibine davet edildiniz';

  const who = input.inviterName?.trim() ? input.inviterName.trim() : undefined;
  const sentenceText =
    (who ? `${who}, ` : '') +
    (clinic ? `${clinic} kliniğinin Klinara hesabına` : 'Klinara ekibine') +
    (input.roleName ? ` ${input.roleName} olarak` : '') +
    ' katılmanız için sizi davet etti.';
  const sentenceHtml =
    (who ? `<strong>${escapeHtml(who)}</strong>, ` : '') +
    (clinic
      ? `<strong>${escapeHtml(clinic)}</strong> kliniğinin Klinara hesabına`
      : 'Klinara ekibine') +
    (input.roleName ? ` <strong>${escapeHtml(input.roleName)}</strong> olarak` : '') +
    ' katılmanız için sizi davet etti.';

  return {
    subject,
    body:
      `${sentenceText}\n\nHesabınızı oluşturmak için: ${input.link}\n` +
      `Bağlantı ${input.ttlHours} saat geçerlidir. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.`,
    html: layout({
      heading: 'Klinara daveti',
      paragraphs: [sentenceHtml, 'Hesabınızı oluşturmak için aşağıdaki düğmeye dokunun.'],
      cta: { label: 'Hesabımı oluştur', link: input.link },
      footnote: `Bağlantı ${input.ttlHours} saat geçerlidir. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.`,
    }),
  };
}

export function passwordResetMail(input: {
  link: string;
  ttlMinutes: number;
}): MailBody & { subject: string } {
  return {
    subject: 'Klinara parola sıfırlama',
    body:
      `Klinara hesabınız için parola sıfırlama isteği aldık.\n\nYeni parola belirlemek için: ${input.link}\n` +
      `Bağlantı ${input.ttlMinutes} dakika geçerlidir ve bir kez kullanılabilir. ` +
      'Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.',
    html: layout({
      heading: 'Parola sıfırlama',
      paragraphs: ['Klinara hesabınız için parola sıfırlama isteği aldık.'],
      cta: { label: 'Yeni parola belirle', link: input.link },
      footnote:
        `Bağlantı ${input.ttlMinutes} dakika geçerlidir ve bir kez kullanılabilir. ` +
        'Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.',
    }),
  };
}
