"use client";

import React, { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";

export default function ExportKeyPage() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { exportWallet: exportSolanaWallet } = useExportWallet();
  const [status, setStatus] = useState<"loading" | "login" | "ready" | "exporting" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // Find the embedded Solana wallet address
  const walletAddress = (user?.linkedAccounts?.find(
    (a: any) =>
      (a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "solana") ||
      a.type === "solana_embedded_wallet"
  ) as any)?.address as string | undefined;

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setStatus("login");
    } else {
      setStatus("ready");
    }
  }, [ready, authenticated]);

  const handleExport = async () => {
    if (!walletAddress) {
      setError("No embedded Solana wallet found");
      setStatus("error");
      return;
    }
    try {
      setStatus("exporting");
      await exportSolanaWallet({ address: walletAddress });
      setStatus("done");
      // Post message back to React Native WebView
      if ((window as any).ReactNativeWebView) {
        (window as any).ReactNativeWebView.postMessage(JSON.stringify({ status: "success" }));
      }
    } catch (err: any) {
      console.error("Export failed:", err);
      setError(err?.message || "Export failed");
      setStatus("error");
      if ((window as any).ReactNativeWebView) {
        (window as any).ReactNativeWebView.postMessage(
          JSON.stringify({ status: "error", error: err?.message || "Export failed" })
        );
      }
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "#0a0a0a",
        color: "#fff",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <img
          src="/favicon.svg"
          alt="Shyft"
          style={{ width: 48, height: 48, marginBottom: 16, borderRadius: 12 }}
        />
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Export Private Key</h1>

        {status === "loading" && (
          <p style={{ color: "#888" }}>Loading...</p>
        )}

        {status === "login" && (
          <>
            <p style={{ color: "#aaa", marginBottom: 20, fontSize: 14 }}>
              Sign in to your Shyft account to export your wallet key.
            </p>
            <button
              onClick={() => login()}
              style={{
                width: "100%",
                padding: "14px 24px",
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                border: "none",
                background: "#6366f1",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Sign In
            </button>
          </>
        )}

        {status === "ready" && (
          <>
            <p style={{ color: "#aaa", marginBottom: 8, fontSize: 14 }}>
              Signed in as{" "}
              <strong style={{ color: "#fff" }}>
                {walletAddress
                  ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                  : "unknown"}
              </strong>
            </p>
            <p style={{ color: "#888", marginBottom: 20, fontSize: 13 }}>
              Tap below to securely export your Solana private key.
            </p>
            <button
              onClick={handleExport}
              style={{
                width: "100%",
                padding: "14px 24px",
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                border: "none",
                background: "#6366f1",
                color: "#fff",
                cursor: "pointer",
                marginBottom: 12,
              }}
            >
              🔑 Export Private Key
            </button>
            <button
              onClick={() => {
                logout();
                if ((window as any).ReactNativeWebView) {
                  (window as any).ReactNativeWebView.postMessage(
                    JSON.stringify({ status: "cancelled" })
                  );
                }
              }}
              style={{
                width: "100%",
                padding: "10px 24px",
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 12,
                border: "1px solid #333",
                background: "transparent",
                color: "#888",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </>
        )}

        {status === "exporting" && (
          <p style={{ color: "#6366f1" }}>Exporting your key...</p>
        )}

        {status === "done" && (
          <p style={{ color: "#22c55e" }}>✓ Key exported successfully. You can close this page.</p>
        )}

        {status === "error" && (
          <>
            <p style={{ color: "#ef4444", marginBottom: 16 }}>{error || "Something went wrong"}</p>
            <button
              onClick={() => setStatus("ready")}
              style={{
                padding: "10px 24px",
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 12,
                border: "1px solid #333",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
