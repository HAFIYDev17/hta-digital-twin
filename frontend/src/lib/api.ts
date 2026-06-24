// src/lib/api.ts

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${options?.method ?? "GET"} ${path} -> ${res.status} ${body}`,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  postesSource: () => request<any[]>("/postes-source"),

  postes: (
    params: { poste_source?: string; depart?: string; search?: string } = {},
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => !!v) as [string, string][],
    ).toString();
    return request<any[]>(`/postes${qs ? `?${qs}` : ""}`);
  },

  topologie: (params: { poste_source?: string; depart?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => !!v) as [string, string][],
    ).toString();
    return request<any[]>(`/topologie${qs ? `?${qs}` : ""}`);
  },

  createPoste: (payload: Partial<any>) =>
    request<any>("/postes", { method: "POST", body: JSON.stringify(payload) }),
  updatePoste: (id: string, payload: Partial<any>) =>
    request<any>(`/postes/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePoste: (id: string) =>
    request<void>(`/postes/${id}`, { method: "DELETE" }),

  departs: (poste_source?: string) =>
    request<any[]>(
      `/departs${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),
  departsDrift: (poste_source?: string) =>
    request<any[]>(
      `/departs/derive${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),

  anomalies: (poste_source?: string) =>
    request<any[]>(
      `/anomalies${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),
  jonctions: () => request<any[]>("/anomalies/jonctions"),

  rm6: (poste_source?: string) =>
    request<any[]>(
      `/actifs/rm6${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),
  updateRm6: (id: string, payload: Record<string, any>) =>
    request<any>(`/actifs/rm6/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  reorderPostes: (items: { id: string; x: number }[]) =>
    request<any>("/actifs/postes/reorder", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  pointsOuverture: (poste_source?: string) =>
    request<any[]>(
      `/actifs/points-ouverture${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),

  snapshots: (poste_source?: string) =>
    request<any[]>(
      `/snapshots${poste_source ? `?poste_source=${poste_source}` : ""}`,
    ),
  createSnapshot: (payload: {
    label?: string;
    poste_source?: string;
    trigger?: "manual" | "scheduled";
  }) =>
    request<any>("/snapshots", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  restoreSnapshot: (id: string) =>
    request<void>(`/snapshots/${id}/restore`, { method: "POST" }),
};
