// Core types for AR application
export interface OrderData {
  id_pesanan: string;
  nama_pelanggan: string;
  link_video: string;
  link_target: string;
  link_frame: string;
  jenis_pesanan: string;
  orientasi: 'portrait' | 'landscape';
  video_posisi: string;
  video_skala: string;
  video_rotasi: string;
  frame_posisi: string;
  frame_skala: string;
  ucapan: string;
  intro: string;
  outro: string;
  slides: any; // Raw slides from old format
  status_pembayaran: string;
  batas_aktif: string;
}

export interface SlideData {
  t: string; // title
  b: string; // body (html allowed)
}

function escapeHtmlAndNl(unsafe: string | null | undefined): string {
  if (!unsafe) return "";
  return unsafe.replace(/\n/g, "<br/>");
}

export function parseSlides(data: OrderData, t: (key: string) => string): SlideData[] {
  let slides: SlideData[] = [];

  const UNIVERSAL_SLIDES: SlideData[] = [
    {
      t: t('Untuk Kamu ✨') || "Untuk Kamu ✨",
      b: t('Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.') || "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga."
    },
    {
      t: t('Melintasi Waktu ⏳') || "Melintasi Waktu ⏳",
      b: t('Waktu mungkin berlalu, namun kenangan indah akan selalu menemukan jalannya untuk kembali.') || "Waktu mungkin berlalu, namun kenangan indah akan selalu menemukan jalannya untuk kembali."
    },
    {
      t: t('Keajaiban Menanti 🌟') || "Keajaiban Menanti 🌟",
      b: t('Arahkan kamera ke foto fisikmu, dan saksikan momen tersebut hidup kembali di hadapanmu.') || "Arahkan kamera ke foto fisikmu, dan saksikan momen tersebut hidup kembali di hadapanmu."
    }
  ];

  let rawSlides = data.slides;
  if (typeof rawSlides === 'string') {
    try {
      rawSlides = JSON.parse(rawSlides);
    } catch (e) {
      rawSlides = null;
    }
  }

  const finalIntro = data.intro;
  const finalUcapan = data.ucapan;
  const finalOutro = data.outro;

  if (Array.isArray(rawSlides) && rawSlides.length > 0) {
    slides = rawSlides.map(s => ({ t: escapeHtmlAndNl(s.title || s.t), b: escapeHtmlAndNl(s.body || s.b) }));
  } else if (finalIntro || finalUcapan || finalOutro) {
    const parts = [];
    if (finalIntro) parts.push({ t: "Intro", b: `<strong>${escapeHtmlAndNl(finalIntro)}</strong>` });
    if (finalUcapan && finalUcapan !== "Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.") {
      parts.push({ t: "Pesan", b: `${escapeHtmlAndNl(finalUcapan)}` });
    } else {
      parts.push({ t: "Pesan", b: `Ada sesuatu yang ingin disampaikan — bukan sekadar kata, tapi rasa yang ingin dijaga.` });
    }
    if (finalOutro) parts.push({ t: "Penutup", b: `<em>${escapeHtmlAndNl(finalOutro)}</em>` });
    slides = parts;
  } else {
    slides = UNIVERSAL_SLIDES;
  }
  return slides;
}

export function getProductRatio(jenis: string, isLandscape: boolean): number {
  const j = (jenis || '').toLowerCase();
  if (j.includes('figura') || j.includes('pigura')) return isLandscape ? 5 / 4 : 4 / 5;
  // Gantungan Kunci (default)
  return isLandscape ? 49 / 32 : 32 / 49;
}
