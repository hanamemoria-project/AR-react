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

    const data = await res.json();
    return data;
  } catch (e: any) {
    if (e.message.includes('fetch')) {
      throw new Error('fetch_failed');
    }
    throw e;
  }
}
