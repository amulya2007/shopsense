import { useEffect, useState } from "react";
import { AuthContext } from "./auth";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("shopsense_user");
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem("shopsense_user", JSON.stringify(user));
    else localStorage.removeItem("shopsense_user");
  }, [user]);

  const login = (token, userData) => {
    localStorage.setItem("shopsense_token", token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem("shopsense_token");
    localStorage.removeItem("shopsense_user");
    setUser(null);
  };

  const updateUser = (changes) => {
    setUser((current) => current ? { ...current, ...changes } : current);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}
