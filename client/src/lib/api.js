import axios from "axios";

const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

const api = axios.create({
  // Development requests use Vite's proxy. Production must receive VITE_API_URL
  // from the deployment environment, e.g. https://your-api.onrender.com/api.
  baseURL: configuredBaseUrl || "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("shopsense_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
