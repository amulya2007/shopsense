import axios from "axios";

const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

// Normalize base URL so that whether VITE_API_URL is empty (relying on Vite proxy),
// a host like http://localhost:8000, or already has /api, it always routes properly to /api
const resolvedBaseUrl = !configuredBaseUrl
  ? "/api"
  : configuredBaseUrl.endsWith("/api")
  ? configuredBaseUrl
  : `${configuredBaseUrl}/api`;

const api = axios.create({
  baseURL: resolvedBaseUrl,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("shopsense_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config?.url !== "/auth/login") {
      localStorage.removeItem("shopsense_token");
      localStorage.removeItem("shopsense_user");
      window.dispatchEvent(new Event("shopsense:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export default api;
