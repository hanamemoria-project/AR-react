export const WORKER_URL = 'https://hm-backend.hanamemoria.workers.dev';

export async function fetchOrderData(idPelanggan: string) {
  try {
    const res = await fetch(`${WORKER_URL}/pesanan?id=${idPelanggan}&t=${Date.now()}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      if (res.status === 404) throw new Error('error_no_data');
      if (res.status === 403) throw new Error('error_expired');
      throw new Error(`HTTP error ${res.status}`);
    }

    let data = await res.json();
    if (Array.isArray(data)) {
      if (data.length > 0) data = data[0];
      else throw new Error('error_no_data');
    }

    // Proxy R2 URLs to avoid CORS issues in AR Viewer
    const R2_BASE = 'https://pub-02d853231cff4efa92ee6754c646a898.r2.dev/';
    const proxyUrl = (url: string) => {
      if (url && typeof url === 'string' && url.startsWith(R2_BASE)) {
        return `${WORKER_URL}/r2/` + url.slice(R2_BASE.length);
      }
      return url;
    };

    if (data) {
      if (data.link_target) data.link_target = proxyUrl(data.link_target);
      if (data.link_video) data.link_video = proxyUrl(data.link_video);
      if (data.link_frame) data.link_frame = proxyUrl(data.link_frame);
      if (data.link_foto) data.link_foto = proxyUrl(data.link_foto);
    }

    return data;
  } catch (e: any) {
    if (e.message.includes('fetch')) {
      throw new Error('fetch_failed');
    }
    throw e;
  }
}
