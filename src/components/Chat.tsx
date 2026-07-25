"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  ArrowLeft,
  Lock,
  Shield,
  Search,
  RefreshCw,
  Plus,
  MessageCircle,
  ShieldCheck,
  KeyRound,
  AlertCircle,
  DollarSign,
  X,
  EyeOff,
  Check,
  Loader2,
  Phone,
  Video,
  PhoneOff,
  PhoneIncoming,
  Trash2,
} from "lucide-react";
import CallModal from "@/components/CallModal";

function getCallRoomName(a: string, b: string): string {
  return [a, b].sort().join("_call_");
}
import { useProgram } from "@/hooks/useProgram";
import { handleIpfsImgError } from "@/components/RichContent";
import { toast } from "@/components/Toast";
import { useWallet } from "@/hooks/usePrivyWallet";
import { PublicKey } from "@solana/web3.js";
import { deriveEncryptionKeypair } from "@/lib/encryption";
import { deriveChatId } from "@/lib/program";
import { useMagicBlockPayment, type MagicBlockPaymentStep } from "@/hooks/useMagicBlockPayment";
import nacl from "tweetnacl";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface ContactInfo {
  pubkey: PublicKey;
  address: string;
  displayName: string;
  username: string;
  avatar: string;
  isMutual: boolean;
}

interface ChatInfo {
  chatId: number;
  friendAddress: string;
  friend: ContactInfo;
  exists: boolean;
  messageCount: number;
  lastMessage: string;
  lastMessageTime: number;
}

interface DecryptedMsg {
  publicKey: string;
  messageIndex: number;
  sender: string;
  content: string;
  decrypted: string | null;
  isPayment: boolean;
  paymentAmount: number;
  timestamp: string;
  isKeyExchange: boolean;
  isEncrypted: boolean;
  isMe: boolean;
}

export default function Chat() {
  const program = useProgram();
  const { publicKey, connected } = useWallet();
  const wallet = useWallet();

  // Encryption state
  const [encryptionKeys, setEncryptionKeys] = useState<nacl.BoxKeyPair | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);

  // State
  const [friends, setFriends] = useState<ContactInfo[]>([]);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [activeChat, setActiveChat] = useState<ChatInfo | null>(null);
  const [peerPubKey, setPeerPubKey] = useState<Uint8Array | null>(null);
  const [messages, setMessages] = useState<DecryptedMsg[]>([]);
  const [messageText, setMessageText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyPublishedChats = useRef(new Set<number>());

  // ── MagicBlock private messaging (opt-in, coexists with E2E) ──
  // Private (MagicBlock TEE) is now the ONLY messaging model — always on, no toggle.
  const [privateMode] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const privateReadyChats = useRef(new Set<number>()); // chats already delegated+permissioned this session
  // Raw wallet message-signer for the TEE auth token.
  const teeSign = useCallback(
    async (m: Uint8Array) => new Uint8Array((await wallet.wallet!.signMessage({ message: m })).signature),
    [wallet]
  );
  // Ensure a chat is delegated to the TEE + permissioned to both members (idempotent).
  const ensureChatPrivate = useCallback(async (chatId: number, peer: PublicKey) => {
    if (!program || !publicKey) return;
    if (privateReadyChats.current.has(chatId)) return;
    try { await program.enablePrivateInbox(chatId); } catch (e: any) {
      if (!/already|delegated|in use|in progress/i.test(e?.message || "")) throw e; // ignore "already set up"
    }
    const { initInboxPermission } = await import("@/lib/privateChat");
    await initInboxPermission(chatId, [publicKey, peer], wallet as any, teeSign);
    privateReadyChats.current.add(chatId);
  }, [program, publicKey, wallet, teeSign]);

  // Delete the private chat: undelegate from the TEE → close → rent back to treasury.
  const handleDeleteChat = useCallback(async () => {
    if (!program || !publicKey || !activeChat) return;
    if (!confirm("Delete this private chat? Messages will be removed and the rent refunded. This can't be undone.")) return;
    setDeleting(true);
    try {
      const chatId = deriveChatId(publicKey, activeChat.friend.pubkey);
      toast("privacy", "Deleting chat", "Undelegating from the MagicBlock TEE…");
      await program.deletePrivateChat(chatId, teeSign, (s) => toast("privacy", "Deleting chat", s));
      privateReadyChats.current.delete(chatId);
      setMessages([]);
      setActiveChat(null);
      toast("success", "Chat deleted 🗑️", "Removed and rent refunded to the treasury");
      loadFriendsAndChats();
    } catch (err: any) {
      console.error("Delete chat error:", err);
      toast("error", "Delete failed", err?.message?.slice(0, 120) || "Try again in a moment");
    }
    setDeleting(false);
  }, [program, publicKey, activeChat, teeSign]);

  // Payment state
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSending, setPaymentSending] = useState(false);

  // MagicBlock private USDC payment hook
  const { sendPrivatePayment, step: mbStep, error: mbError, txSignature: mbTxSig, reset: resetMb } = useMagicBlockPayment();

  // Call state
  const [callMode, setCallMode] = useState<"voice" | "video" | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ mode: "voice" | "video"; from: string } | null>(null);
  const seenCallMessages = useRef(new Set<string>());
  const lastCallSentRef = useRef<number>(0); // timestamp of last call signal sent

  // Send a CALL signal message in chat, then open the modal
  const handleStartCall = async (mode: "voice" | "video") => {
    if (!activeChat || !program || !publicKey) return;

    // Debounce: prevent sending duplicate call signals within 10 seconds
    const now = Date.now();
    if (now - lastCallSentRef.current < 10000) {
      setCallMode(mode);
      return;
    }
    lastCallSentRef.current = now;

    const myAddr = publicKey.toBase58();
    const roomName = getCallRoomName(myAddr, activeChat.friend.address);
    const callContent = `CALL:${mode}:${roomName}`;

    // Send signal on-chain as a plain message
    try {
      let chatInfo = activeChat;
      if (!chatInfo.exists) {
        toast("error", "Start a chat first", "Send a message before calling");
        return;
      }
      const msgIndex = await program.getNextMessageIndex(chatInfo.chatId);
      await program.sendMessageSimple(chatInfo.chatId, msgIndex, `PLAIN:${callContent}`);
    } catch (err) {
      console.error("Call signal send failed:", err);
    }

    setCallMode(mode);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Derive encryption keys from wallet on mount
  useEffect(() => {
    if (!publicKey || !wallet.wallet || encryptionKeys) return;

    const deriveKeys = async () => {
      setKeysLoading(true);
      try {
        const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
          const result = await wallet.wallet!.signMessage({ message });
          return new Uint8Array(result.signature);
        };
        const keys = await deriveEncryptionKeypair(publicKey.toBase58(), signMessage);
        setEncryptionKeys(keys);
        // Log derived pubkey so we can verify it matches what's published on-chain
        const pubKeyB64 = btoa(String.fromCharCode(...keys.publicKey));
        console.log("🔑 E2E encryption keys derived, myPubKey(b64)=", pubKeyB64);
      } catch (err: any) {
        console.error("Failed to derive encryption keys:", err);
        toast("error", "Encryption key error", "Could not derive encryption keys. Try reconnecting.");
      }
      setKeysLoading(false);
    };
    deriveKeys();
  }, [publicKey, wallet.wallet, encryptionKeys]);

  // Load contacts and chat list
  const loadFriendsAndChats = useCallback(async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      const [followingList, followersList, profiles] = await Promise.all([
        program.getFollowing(publicKey),
        program.getFollowers(publicKey),
        program.getAllProfiles(),
      ]);

      const profileMap: Record<string, any> = {};
      profiles.forEach((p: any) => { profileMap[p.owner] = p; });

      const contactInfos: ContactInfo[] = followingList.map((addr: string) => {
        const profile = profileMap[addr];
        const isMutual = followersList.includes(addr);
        return {
          pubkey: new PublicKey(addr),
          address: addr,
          displayName: profile?.displayName || profile?.display_name || addr.slice(0, 4) + "..." + addr.slice(-4),
          username: profile?.username || addr.slice(0, 8),
          avatar: profile?.avatarUrl || (isMutual ? "👥" : "👤"),
          isMutual,
        };
      });
      setFriends(contactInfos);

      const chatInfos: ChatInfo[] = [];
      for (const friend of contactInfos) {
        const chatId = deriveChatId(publicKey, friend.pubkey);
        const chatData = await program.getChat(chatId);
        const exists = chatData !== null;
        let lastMsg = "";
        let lastTime = 0;
        let msgCount = 0;

        if (exists) {
          msgCount = Number(chatData.messageCount || 0);
          if (msgCount > 0) {
            try {
              const msgs = await program.getMessagesForChat(chatId);
              const visibleMsgs = msgs.filter((m: any) => !m.content.startsWith("PUBKEY:"));
              if (visibleMsgs.length > 0) {
                const last = visibleMsgs[visibleMsgs.length - 1];
                if (last.content.startsWith("ENC:")) {
                  lastMsg = "🔒 Encrypted message";
                } else {
                  lastMsg = last.content.slice(0, 40);
                }
                lastTime = Number(last.timestamp || "0") * 1000;
              } else {
                lastMsg = "🔑 Key exchange complete";
              }
            } catch {
              lastMsg = "Chat active";
            }
          }
        }

        chatInfos.push({
          chatId,
          friendAddress: friend.address,
          friend,
          exists,
          messageCount: msgCount,
          lastMessage: exists ? (lastMsg || "Start chatting...") : "Tap to start private chat",
          lastMessageTime: lastTime,
        });
      }

      chatInfos.sort((a, b) => {
        if (a.exists && !b.exists) return -1;
        if (!a.exists && b.exists) return 1;
        return b.lastMessageTime - a.lastMessageTime;
      });
      setChats(chatInfos);
    } catch (err) {
      console.error("Failed to load chats:", err);
    }
    setLoading(false);
  }, [program, publicKey]);

  useEffect(() => {
    loadFriendsAndChats();
  }, [loadFriendsAndChats]);

  // Load messages for active chat
  const loadMessages = useCallback(async (chatInfo: ChatInfo) => {
    if (!program || !publicKey || !encryptionKeys) return;
    setLoadingMessages(true);
    try {
      const myAddr = publicKey.toBase58();

      // In private (MagicBlock TEE) mode, the E2E key-exchange is irrelevant — the
      // TEE enforces privacy. Skip all the on-chain key lookups + public reads
      // (they were flooding /api/rpc with 429s); messages come from the inbox read.
      if (privateMode) {
        setPeerPubKey(null);
      } else {

      // Check if we've already published our key (read-only — actual publishing happens in handleSend)
      if (chatInfo.exists && !keyPublishedChats.current.has(chatInfo.chatId)) {
        try {
          const hasMyKey = await program.findMyEncryptionKey(chatInfo.chatId, myAddr);
          if (hasMyKey) {
            keyPublishedChats.current.add(chatInfo.chatId);
          }
          // If not published, handleSend will publish before sending
        } catch (keyErr) {
          console.warn("Key check failed:", keyErr);
        }
      }

      // Now check for peer's key (uses direct PDA lookups, no cache)
      const peerKey = await program.findPeerEncryptionKey(chatInfo.chatId, myAddr);
      setPeerPubKey(peerKey);

      if (peerKey) {
        const decrypted = await program.getDecryptedMessages(
          chatInfo.chatId,
          myAddr,
          encryptionKeys.secretKey,
          peerKey
        );
        setMessages(decrypted);
        // Detect incoming call signals from peer
        for (const msg of decrypted) {
          if (msg.isMe) continue;
          const text = msg.decrypted || msg.content || "";
          if (text.startsWith("CALL:") && !seenCallMessages.current.has(msg.publicKey + msg.messageIndex)) {
            seenCallMessages.current.add(msg.publicKey + msg.messageIndex);
            const parts = text.split(":");
            if (parts.length >= 2) {
              const cMode = parts[1] as "voice" | "video";
              if (!callMode) setIncomingCall({ mode: cMode, from: msg.sender });
            }
          }
        }
      } else {
        const raw = await program.getMessagesForChat(chatInfo.chatId);
        setMessages(raw.map((m: any) => ({
          publicKey: m.publicKey,
          messageIndex: m.messageIndex,
          sender: m.sender,
          content: m.content,
          decrypted: m.content.startsWith("PLAIN:") ? m.content.slice(6) : null,
          isPayment: m.isPayment,
          paymentAmount: m.paymentAmount,
          timestamp: m.timestamp,
          isKeyExchange: m.content.startsWith("PUBKEY:"),
          isEncrypted: m.content.startsWith("ENC:") || m.content.startsWith("PLAIN:"),
          isMe: m.sender === myAddr,
        })));
      }
      } // end !privateMode E2E block

      // ── Merge MagicBlock private (TEE inbox) messages, if this chat uses them ──
      // Auto-detect an on-chain private inbox so the RECIPIENT sees private
      // messages without having to flip the toggle themselves.
      let hasPrivateInbox = privateReadyChats.current.has(chatInfo.chatId) || privateMode;
      if (!hasPrivateInbox) {
        try {
          const { getInboxPda } = await import("@/lib/privateChat");
          const info = await program.provider.connection.getAccountInfo(getInboxPda(chatInfo.chatId));
          if (info) { hasPrivateInbox = true; privateReadyChats.current.add(chatInfo.chatId); }
        } catch { /* ignore */ }
      }
      if (hasPrivateInbox) {
        try {
          const { readInbox } = await import("@/lib/privateChat");
          const priv = await readInbox(chatInfo.chatId, publicKey, teeSign);
          if (priv.length) {
            const mapped = priv.map((p, i) => ({
              publicKey: "priv-" + i, messageIndex: 1_000_000 + i, sender: p.sender,
              content: p.content, decrypted: p.content.startsWith("PLAIN:") ? p.content.slice(6) : p.content,
              isPayment: false, paymentAmount: 0, timestamp: p.timestamp,
              isKeyExchange: false, isEncrypted: true, isMe: p.sender === myAddr,
            }));
            setMessages((prev) => {
              const base = prev.filter((m) => !String(m.publicKey).startsWith("priv-") && m.publicKey !== "pending");
              return [...base, ...mapped].sort((a, b) => Number(a.timestamp) - Number(b.timestamp) || a.messageIndex - b.messageIndex);
            });
          }
        } catch { /* not private / no access — ignore */ }
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([]);
    }
    setLoadingMessages(false);
  }, [program, publicKey, encryptionKeys, privateMode, teeSign]);

  // Keep a stable ref to the latest loadMessages so the poll interval below is
  // created ONCE per chat — NOT recreated on every render. (loadMessages changes
  // identity each render via teeSign/wallet; having it in the effect deps made the
  // effect re-fire every render → an immediate loadMessages() call every render →
  // request storm → 429s on /api/rpc and the TEE, which surface as CORS errors.)
  const loadMessagesRef = useRef(loadMessages);
  loadMessagesRef.current = loadMessages;

  // Poll for new messages — interval set once per chat, driven by the ref.
  useEffect(() => {
    if (!activeChat) return;
    if (!activeChat.exists) return;
    const chat = activeChat;

    loadMessagesRef.current(chat); // load immediately

    const loadingRef = { current: false };
    pollRef.current = setInterval(async () => { // 30s interval
      if (loadingRef.current) return;
      loadingRef.current = true;
      try { await loadMessagesRef.current(chat); } finally { loadingRef.current = false; }
    }, 30000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeChat?.chatId, activeChat?.exists]);

  const selectChat = async (chat: ChatInfo) => {
    setActiveChat(chat);
    setMessages([]);
    setPeerPubKey(null);
    // Don't call loadMessages here — the useEffect watches activeChat and will call it
  };

  const handleSend = async () => {
    if (!messageText.trim() || !program || !publicKey || !encryptionKeys) return;
    const content = messageText.trim();
    setMessageText("");
    setSending(true);

    // ── MagicBlock PRIVATE path (opt-in). Runs entirely over the TEE rollup. ──
    if (privateMode && activeChat) {
      try {
        const peer = activeChat.friend.pubkey;
        const chatId = deriveChatId(publicKey, peer);
        const { appendPrivateMessage } = await import("@/lib/privateChat");

        if (!privateReadyChats.current.has(chatId)) {
          toast("privacy", "Securing chat", "Setting up MagicBlock TEE inbox…");
        }
        await ensureChatPrivate(chatId, peer);

        const localMsg: DecryptedMsg = {
          publicKey: "pending", messageIndex: Date.now(), sender: publicKey.toBase58(),
          content: "PLAIN:" + content, decrypted: content, isPayment: false, paymentAmount: 0,
          timestamp: Math.floor(Date.now() / 1000).toString(), isKeyExchange: false, isEncrypted: true, isMe: true,
        };
        setMessages((prev) => [...prev, localMsg]);
        await appendPrivateMessage(chatId, "PLAIN:" + content, wallet as any, teeSign);
        toast("success", "Sent privately 🔒", "Delivered inside the MagicBlock TEE");
      } catch (err: any) {
        console.error("Private send error:", err);
        toast("error", "Private send failed", err?.error?.errorMessage || err?.message?.slice(0, 100) || "Try again");
        setMessages((prev) => prev.filter((m) => m.publicKey !== "pending"));
      }
      setSending(false);
      return;
    }

    try {
      let chatInfo = activeChat;

      if (!chatInfo || !chatInfo.exists) {
        if (!chatInfo) { setSending(false); return; }
        setCreatingChat(true);
        toast("privacy", "Creating encrypted chat", "Setting up E2E encryption on-chain...");

        const { chatId, isNew } = await program.getOrCreateE2EChat(
          chatInfo.friend.pubkey,
          encryptionKeys.publicKey
        );

        chatInfo = { ...chatInfo, chatId, exists: true, messageCount: isNew ? 1 : chatInfo.messageCount };
        setActiveChat(chatInfo);
        setChats(prev => prev.map(c =>
          c.friendAddress === chatInfo!.friendAddress ? chatInfo! : c
        ));
        setCreatingChat(false);
        toast("success", "Chat created! 🔐", "E2E encrypted channel established on-chain");

        const myAddr = publicKey.toBase58();
        const peerKey = await program.findPeerEncryptionKey(chatInfo.chatId, myAddr);
        setPeerPubKey(peerKey);

      }

      // ===== STEP 1: Ensure our encryption key is published FIRST =====
      // Always verify on-chain when there's no confirmed peer key yet (don't trust in-memory cache alone)
      const myAddr = publicKey.toBase58();
      console.log(`📤 handleSend: chatId=${chatInfo.chatId}, exists=${chatInfo.exists}, myAddr=${myAddr.slice(0,8)}...`);

      const skipKeyCheck = keyPublishedChats.current.has(chatInfo.chatId) && peerPubKey !== null;
      console.log(`📤 handleSend: skipKeyCheck=${skipKeyCheck} (cached=${keyPublishedChats.current.has(chatInfo.chatId)}, hasPeerKey=${peerPubKey !== null})`);

      if (chatInfo.exists && !skipKeyCheck) {
        try {
          const hasMyKey = await program.findMyEncryptionKey(chatInfo.chatId, myAddr);
          console.log(`📤 handleSend: findMyEncryptionKey result: ${hasMyKey}`);
          if (!hasMyKey) {
            console.log("🔑 handleSend: Publishing our encryption key before sending...");
            const keyMsgIndex = await program.getNextMessageIndex(chatInfo.chatId);
            console.log(`🔑 handleSend: Next available index for PUBKEY: ${keyMsgIndex}`);
            await program.publishEncryptionKey(chatInfo.chatId, keyMsgIndex, encryptionKeys.publicKey);
            console.log("✅ handleSend: Encryption key published at index", keyMsgIndex);
            keyPublishedChats.current.add(chatInfo.chatId);
          } else {
            console.log("✅ handleSend: Our key already on-chain");
            keyPublishedChats.current.add(chatInfo.chatId);
          }
        } catch (keyErr) {
          console.error("❌ handleSend: Key publish failed:", keyErr);
        }
      }

      // ===== STEP 2: Fresh peer key lookup AFTER our key is published =====
      let peerKey = await program.findPeerEncryptionKey(chatInfo.chatId, myAddr);
      console.log(`📤 handleSend: peer key found? ${peerKey ? "YES" : "NO"}`);
      setPeerPubKey(peerKey);

      // ===== STEP 3: Get message index AFTER key publish (so we don't collide) =====
      const msgIndex = await program.getNextMessageIndex(chatInfo.chatId);
      console.log(`📤 handleSend: sending message at index ${msgIndex}, encrypted=${!!peerKey}`);

      const localMsg: DecryptedMsg = {
        publicKey: "pending",
        messageIndex: msgIndex,
        sender: publicKey.toBase58(),
        content: peerKey ? "ENC:..." : "PLAIN:" + content,
        decrypted: content,
        isPayment: false,
        paymentAmount: 0,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        isKeyExchange: false,
        isEncrypted: true,
        isMe: true,
      };
      setMessages(prev => [...prev, localMsg]);

      if (peerKey) {
        // E2E encrypted send
        await program.sendE2EMessage(
          chatInfo.chatId,
          msgIndex,
          content,
          encryptionKeys.secretKey,
          peerKey
        );
      } else {
        // No peer key yet — send as plaintext (on-chain but readable)
        // This ensures the message lands immediately without waiting for key exchange
        await program.sendMessageSimple(
          chatInfo.chatId,
          msgIndex,
          "PLAIN:" + content
        );
        toast("privacy", "Sent (pre-encryption)", "Future messages will be E2E encrypted after key exchange.");
      }

      setChats(prev => prev.map(c =>
        c.friendAddress === chatInfo!.friendAddress
          ? { ...c, lastMessage: "🔒 Encrypted message", lastMessageTime: Date.now(), exists: true, messageCount: msgIndex + 1 }
          : c
      ));
    } catch (err: any) {
      console.error("Send error:", err);
      toast("error", "Failed to send", err?.message?.slice(0, 80) || "Transaction failed");
      setMessages(prev => prev.filter(m => m.publicKey !== "pending"));
    }
    setSending(false);
  };

  // Send private USDC payment in chat via MagicBlock
  const handleSendPayment = async () => {
    if (!activeChat || !program || !publicKey || !encryptionKeys) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast("error", "Invalid amount", "Please enter a valid amount");
      return;
    }

    setPaymentSending(true);
    try {
      const recipientAddress = activeChat.friend.address;

      // MagicBlock private USDC transfer
      const result = await sendPrivatePayment(recipientAddress, amount, "private");
      const txSig = result?.transferSig || null;

      if (!txSig) {
        // Don't show error toast if user just cancelled
        const errMsg = mbError || "Transaction was not completed";
        if (!errMsg.includes("cancelled")) {
          toast("error", "Payment failed", errMsg);
        }
        setPaymentSending(false);
        return;
      }

      // Send a payment message in the chat so both users see it
      const paymentContent = `💸 Sent ${amount} USDC privately • tx: ${txSig.slice(0, 8)}...`;

      // Ensure chat exists
      let chatInfo = activeChat;
      if (!chatInfo.exists) {
        setCreatingChat(true);
        const { chatId, isNew } = await program.getOrCreateE2EChat(
          chatInfo.friend.pubkey,
          encryptionKeys.publicKey
        );
        chatInfo = { ...chatInfo, chatId, exists: true, messageCount: isNew ? 1 : chatInfo.messageCount };
        setActiveChat(chatInfo);
        setChats(prev => prev.map(c =>
          c.friendAddress === chatInfo!.friendAddress ? chatInfo! : c
        ));
        setCreatingChat(false);
      }

      // Ensure encryption key is published
      const myAddr = publicKey.toBase58();
      if (chatInfo.exists && !keyPublishedChats.current.has(chatInfo.chatId)) {
        try {
          const hasMyKey = await program.findMyEncryptionKey(chatInfo.chatId, myAddr);
          if (!hasMyKey) {
            const keyMsgIndex = await program.getNextMessageIndex(chatInfo.chatId);
            await program.publishEncryptionKey(chatInfo.chatId, keyMsgIndex, encryptionKeys.publicKey);
            keyPublishedChats.current.add(chatInfo.chatId);
          } else {
            keyPublishedChats.current.add(chatInfo.chatId);
          }
        } catch (keyErr) {
          console.error("Key publish failed during payment:", keyErr);
        }
      }

      // Send payment notification as chat message
      const peerKey = await program.findPeerEncryptionKey(chatInfo.chatId, myAddr);
      setPeerPubKey(peerKey);
      const msgIndex = await program.getNextMessageIndex(chatInfo.chatId);

      // Add optimistic local message
      const localMsg: DecryptedMsg = {
        publicKey: "pending-pay",
        messageIndex: msgIndex,
        sender: publicKey.toBase58(),
        content: "PAY:" + paymentContent,
        decrypted: paymentContent,
        isPayment: true,
        paymentAmount: amount,
        timestamp: Math.floor(Date.now() / 1000).toString(),
        isKeyExchange: false,
        isEncrypted: true,
        isMe: true,
      };
      setMessages(prev => [...prev, localMsg]);

      if (peerKey) {
        await program.sendE2EMessage(
          chatInfo.chatId,
          msgIndex,
          `PAY:${amount}:USDC:${txSig}`,
          encryptionKeys.secretKey,
          peerKey
        );
      } else {
        await program.sendMessageSimple(
          chatInfo.chatId,
          msgIndex,
          `PLAIN:PAY:${amount}:USDC:${txSig}`
        );
      }

      setChats(prev => prev.map(c =>
        c.friendAddress === chatInfo!.friendAddress
          ? { ...c, lastMessage: `💸 ${amount} USDC`, lastMessageTime: Date.now(), exists: true, messageCount: msgIndex + 1 }
          : c
      ));

      toast("success", "Payment sent! 💸", `${amount} USDC → @${activeChat.friend.username}`);
      setShowPayment(false);
      setPaymentAmount("");
      resetMb();
    } catch (err: any) {
      console.error("Payment error:", err);
      toast("error", "Payment failed", err?.message?.slice(0, 80) || "Transaction failed");
      setMessages(prev => prev.filter(m => m.publicKey !== "pending-pay"));
    }
    setPaymentSending(false);
  };

  const filteredChats = chats.filter(c =>
    c.friend.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.friend.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!connected) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#EFF6FF] to-[#F0FDF4] flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-[#7C3AED]" />
          </div>
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">E2E Encrypted Chat</h3>
          <p className="text-sm text-[#64748B]">Connect your wallet to access private, encrypted messaging on Solana</p>
        </div>
      </div>
    );
  }

  if (keysLoading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center">
          <KeyRound className="w-10 h-10 text-[#7C3AED] animate-pulse mx-auto mb-3" />
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Deriving Encryption Keys</h3>
          <p className="text-sm text-[#64748B]">Sign the message in your wallet to generate your encryption keypair...</p>
        </div>
      </div>
    );
  }

  if (!encryptionKeys) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-[#EF4444] mx-auto mb-3" />
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Encryption Keys Required</h3>
          <p className="text-sm text-[#64748B] mb-4">Could not derive encryption keys. Please reconnect your wallet.</p>
          <button
            onClick={() => { setEncryptionKeys(null); setKeysLoading(false); }}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-all"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container flex h-[calc(100vh-120px)] sm:h-[calc(100vh-73px)] md:h-[calc(100vh-73px)] max-w-5xl mx-auto bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
      {/* Conversation List */}
      <div
        className={`w-full md:w-80 border-r border-[#E2E8F0] flex flex-col ${
          activeChat ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-3 sm:p-4 border-b border-[#E2E8F0]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-sm text-[#1A1A2E]">Messages</h2>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] font-medium">🔒 Private</span>
            </div>
            <button
              onClick={loadFriendsAndChats}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && chats.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 text-[#94A3B8] animate-spin" />
            </div>
          )}

          {!loading && filteredChats.length === 0 && (
            <div className="p-6 text-center">
              <MessageCircle className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
              <p className="text-sm text-[#94A3B8] mb-1">No conversations yet</p>
              <p className="text-xs text-[#94A3B8]">Follow people to start encrypted chats</p>
            </div>
          )}

          {filteredChats.map((chat) => (
            <button
              key={chat.friendAddress}
              onClick={() => selectChat(chat)}
              className={`touch-active w-full flex items-center gap-3 px-3 sm:px-4 py-3 sm:py-3.5 hover:bg-[#F8FAFC] active:bg-[#F1F5F9] transition-colors border-b border-[#F1F5F9] ${
                activeChat?.friendAddress === chat.friendAddress ? "bg-[#EFF6FF]" : ""
              }`}
            >
              <div className="relative">
                {chat.friend.avatar && chat.friend.avatar.startsWith("http") ? (
                  <img src={chat.friend.avatar} onError={handleIpfsImgError} alt={chat.friend.displayName} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-xl">
                    {chat.friend.avatar}
                  </div>
                )}
                {chat.exists ? (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#16A34A] border-2 border-white flex items-center justify-center">
                    <Lock className="w-2 h-2 text-white" />
                  </div>
                ) : (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#94A3B8] border-2 border-white" />
                )}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[#1A1A2E] truncate">{chat.friend.displayName}</span>
                  <span className="text-[10px] text-[#94A3B8] flex-shrink-0">
                    {chat.lastMessageTime > 0 ? timeAgo(chat.lastMessageTime) : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {chat.exists ? (
                    <Lock className="w-2.5 h-2.5 text-[#16A34A] flex-shrink-0" />
                  ) : (
                    <Plus className="w-2.5 h-2.5 text-[#94A3B8] flex-shrink-0" />
                  )}
                  <p className="text-xs text-[#64748B] truncate">{chat.lastMessage}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex flex-col ${activeChat ? "flex" : "hidden md:flex"}`}>
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[#E2E8F0] bg-white">
              <button
                onClick={() => { setActiveChat(null); setMessages([]); setPeerPubKey(null); }}
                className="md:hidden w-9 h-9 rounded-lg hover:bg-[#F1F5F9] active:bg-[#E2E8F0] flex items-center justify-center flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5 text-[#64748B]" />
              </button>
              {activeChat.friend.avatar && activeChat.friend.avatar.startsWith("http") ? (
                <img src={activeChat.friend.avatar} onError={handleIpfsImgError} alt={activeChat.friend.displayName} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-base sm:text-lg flex-shrink-0">
                  {activeChat.friend.avatar}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-[#1A1A2E]">
                  {activeChat.friend.displayName}
                </span>
                <div className="flex items-center gap-1">
                  {privateMode ? (
                    <>
                      <ShieldCheck className="w-2.5 h-2.5 text-[#16A34A]" />
                      <span className="text-[10px] text-[#16A34A] font-medium">Private • MagicBlock TEE</span>
                    </>
                  ) : activeChat.exists && peerPubKey ? (
                    <>
                      <ShieldCheck className="w-2.5 h-2.5 text-[#16A34A]" />
                      <span className="text-[10px] text-[#16A34A] font-medium">E2E Encrypted • On-Chain • NaCl Box</span>
                    </>
                  ) : activeChat.exists ? (
                    <>
                      <KeyRound className="w-2.5 h-2.5 text-[#F59E0B]" />
                      <span className="text-[10px] text-[#F59E0B] font-medium">Waiting for key exchange...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-2.5 h-2.5 text-[#94A3B8]" />
                      <span className="text-[10px] text-[#94A3B8] font-medium">Send a message to start encrypted chat</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleStartCall("voice")}
                  title="Voice call"
                  className="w-8 h-8 rounded-lg hover:bg-[#F1F5F9] flex items-center justify-center transition-colors"
                >
                  <Phone className="w-4 h-4 text-[#16A34A]" />
                </button>
                <button
                  onClick={() => handleStartCall("video")}
                  title="Video call"
                  className="w-8 h-8 rounded-lg hover:bg-[#F1F5F9] flex items-center justify-center transition-colors"
                >
                  <Video className="w-4 h-4 text-[#2563EB]" />
                </button>
                {activeChat.exists && (
                  <button
                    onClick={() => {
                      // Clear peer key cache so refresh forces a full re-scan
                      if (program && publicKey) {
                        program.clearPeerKeyCache(activeChat.chatId, publicKey.toBase58());
                      }
                      loadMessages(activeChat);
                    }}
                    disabled={loadingMessages}
                    className="w-8 h-8 rounded-lg hover:bg-[#F1F5F9] flex items-center justify-center"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[#94A3B8] ${loadingMessages ? "animate-spin" : ""}`} />
                  </button>
                )}
                <button
                  onClick={handleDeleteChat}
                  disabled={deleting}
                  title="Delete chat & refund rent"
                  className="w-8 h-8 rounded-lg hover:bg-[#FEE2E2] flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Trash2 className={`w-3.5 h-3.5 text-[#EF4444] ${deleting ? "animate-pulse" : ""}`} />
                </button>
              </div>

              {/* Incoming call banner */}
              {incomingCall && !callMode && (
                <div className="absolute top-14 left-0 right-0 z-40 mx-4 bg-[#1A1A2E] text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl border border-[#16A34A]/30">
                  <div className="w-9 h-9 rounded-full bg-[#16A34A] flex items-center justify-center animate-pulse flex-shrink-0">
                    <PhoneIncoming className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{activeChat.friend.displayName}</p>
                    <p className="text-xs text-white/60">Incoming {incomingCall.mode} call...</p>
                  </div>
                  <button
                    onClick={() => setIncomingCall(null)}
                    className="w-9 h-9 rounded-full bg-[#EF4444] flex items-center justify-center flex-shrink-0"
                  >
                    <PhoneOff className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={() => { setCallMode(incomingCall.mode); setIncomingCall(null); }}
                    className="w-9 h-9 rounded-full bg-[#16A34A] flex items-center justify-center flex-shrink-0"
                  >
                    <Phone className="w-4 h-4 text-white" />
                  </button>
                </div>
              )}

              {/* Call Modal */}
              {callMode && publicKey && (
                <CallModal
                  myAddress={publicKey.toBase58()}
                  peerAddress={activeChat.friend.address}
                  peerName={activeChat.friend.displayName}
                  peerAvatar={activeChat.friend.avatar}
                  mode={callMode}
                  isIncoming={!!incomingCall}
                  onClose={() => { setCallMode(null); setIncomingCall(null); }}
                />
              )}

            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAFBFC]">
              <div className="flex justify-center mb-4">
                <span className="text-[10px] text-[#94A3B8] bg-white px-3 py-1 rounded-full border border-[#E2E8F0] flex items-center gap-1">
                  {privateMode ? (
                    <>
                      <ShieldCheck className="w-2.5 h-2.5 text-[#16A34A]" /> Private — messages run inside the MagicBlock TEE
                    </>
                  ) : activeChat.exists && peerPubKey ? (
                    <>
                      <ShieldCheck className="w-2.5 h-2.5 text-[#16A34A]" /> End-to-end encrypted — NaCl Box on Solana
                    </>
                  ) : activeChat.exists ? (
                    <>
                      <KeyRound className="w-2.5 h-2.5 text-[#F59E0B]" /> Key exchange in progress...
                    </>
                  ) : (
                    <>
                      <Shield className="w-2.5 h-2.5" /> First message creates an encrypted channel on-chain
                    </>
                  )}
                </span>
              </div>

              {creatingChat && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <RefreshCw className="w-6 h-6 text-[#7C3AED] animate-spin mx-auto mb-2" />
                    <p className="text-sm text-[#7C3AED] font-medium">Creating encrypted channel...</p>
                    <p className="text-xs text-[#94A3B8] mt-1">Establishing keys on Solana</p>
                  </div>
                </div>
              )}

              {loadingMessages && messages.length === 0 && !creatingChat && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 text-[#94A3B8] animate-spin" />
                </div>
              )}

              {!loadingMessages && messages.length === 0 && activeChat.exists && !creatingChat && (
                <div className="text-center py-8">
                  <p className="text-sm text-[#94A3B8]">No messages yet. Say hello! 👋</p>
                </div>
              )}

              {!activeChat.exists && messages.length === 0 && !creatingChat && (
                <div className="text-center py-8">
                  <ShieldCheck className="w-10 h-10 text-[#16A34A] mx-auto mb-3" />
                  <p className="text-sm text-[#64748B] mb-1">Private messaging</p>
                  <p className="text-xs text-[#94A3B8]">Messages run inside the MagicBlock TEE (Private Ephemeral Rollup)</p>
                  <p className="text-xs text-[#94A3B8] mt-1">Only you and the recipient can read them 🔒</p>
                </div>
              )}

              {messages.filter(m => !m.isKeyExchange).map((msg, i) => {
                const isPaymentMsg = msg.isPayment || msg.decrypted?.startsWith("PAY:") || msg.content?.startsWith("PAY:");
                const isCallMsg = (msg.decrypted || "").startsWith("CALL:") || (msg.content || "").startsWith("PLAIN:CALL:");
                let displayText = msg.isEncrypted
                  ? (msg.decrypted || "🔒 Unable to decrypt")
                  : msg.content;

                // Parse payment messages for display
                let payAmount = "";
                let payCurrency = "";
                let payTxSig = "";
                if (isPaymentMsg && msg.decrypted) {
                  const raw = msg.decrypted.startsWith("PAY:") ? msg.decrypted : msg.decrypted;
                  const parts = raw.replace(/^PAY:/, "").split(":");
                  if (parts.length >= 3) {
                    payAmount = parts[0];
                    payCurrency = parts[1];
                    payTxSig = parts[2];
                    displayText = `💸 ${payAmount} ${payCurrency}`;
                  } else if (raw.startsWith("💸")) {
                    displayText = raw;
                  }
                }

                // Parse call mode for display
                const callMsgMode = isCallMsg
                  ? ((msg.decrypted || msg.content || "").split(":")[1] || "voice") as "voice" | "video"
                  : "voice";

                return (
                  <div key={`${msg.timestamp}-${i}`} className={`flex ${msg.isMe ? "justify-end" : "justify-start"}`}>
                    {isCallMsg ? (
                      <div className={`max-w-[85%] sm:max-w-[260px] rounded-2xl overflow-hidden border ${
                        msg.isMe ? "border-[#2563EB]/30 bg-[#EFF6FF]" : "border-[#16A34A]/30 bg-[#F0FDF4]"
                      }`}>
                        <div className={`px-4 py-3 flex items-center gap-3`}>
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                            msg.isMe ? "bg-[#2563EB]" : "bg-[#16A34A]"
                          }`}>
                            {callMsgMode === "video"
                              ? <Video className="w-4 h-4 text-white" />
                              : <Phone className="w-4 h-4 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#1A1A2E]">
                              {callMsgMode === "video" ? "Video Call" : "Voice Call"}
                            </p>
                            <p className="text-xs text-[#64748B]">
                              {msg.isMe ? "You called" : `${activeChat.friend.displayName} called`}
                            </p>
                          </div>
                          {!msg.isMe && (
                            <button
                              onClick={() => { setCallMode(callMsgMode); setIncomingCall(null); }}
                              className="text-xs font-semibold text-white bg-[#16A34A] px-3 py-1.5 rounded-lg hover:bg-[#15803D] transition-colors flex-shrink-0"
                            >
                              Join
                            </button>
                          )}
                        </div>
                        <div className={`px-4 py-1 text-[10px] ${msg.isMe ? "text-[#93C5FD]" : "text-[#86EFAC]"}`}>
                          {Number(msg.timestamp) > 0 ? timeAgo(Number(msg.timestamp) * 1000) : "now"}
                        </div>
                      </div>
                    ) : isPaymentMsg ? (
                      <div
                        className={`max-w-[85%] sm:max-w-[320px] rounded-2xl text-sm overflow-hidden ${
                          msg.isMe
                            ? "chat-bubble-me rounded-br-md"
                            : "chat-bubble-them rounded-bl-md border border-[#E2E8F0]"
                        }`}
                      >
                        <div className={`px-4 py-3 ${msg.isMe ? "bg-gradient-to-r from-[#7C3AED] to-[#6D28D9]" : "bg-gradient-to-r from-[#F5F3FF] to-[#EDE9FE]"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <DollarSign className={`w-4 h-4 ${msg.isMe ? "text-purple-200" : "text-[#7C3AED]"}`} />
                            <span className={`font-bold text-base ${msg.isMe ? "text-white" : "text-[#1A1A2E]"}`}>
                              {payAmount || msg.paymentAmount || ""} {payCurrency || "USDC"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <EyeOff className={`w-3 h-3 ${msg.isMe ? "text-purple-300" : "text-[#7C3AED]/60"}`} />
                            <span className={`text-[11px] ${msg.isMe ? "text-purple-200" : "text-[#7C3AED]/70"}`}>
                              Private Payment via MagicBlock
                            </span>
                          </div>
                          {payTxSig && (
                            <a
                              href={`https://solscan.io/tx/${payTxSig}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-[10px] mt-1 block underline ${msg.isMe ? "text-purple-200/80" : "text-[#7C3AED]/50"}`}
                            >
                              tx: {payTxSig.slice(0, 12)}...
                            </a>
                          )}
                        </div>
                        <div className={`px-4 py-1.5 flex items-center gap-1 ${msg.isMe ? "bg-[#6D28D9]" : "bg-[#EDE9FE]"}`}>
                          <span className={`text-[10px] ${msg.isMe ? "text-purple-200" : "text-[#94A3B8]"}`}>
                            {Number(msg.timestamp) > 0 ? timeAgo(Number(msg.timestamp) * 1000) : "now"}
                          </span>
                          <Shield className={`w-2 h-2 ${msg.isMe ? "text-purple-300" : "text-[#7C3AED]"}`} />
                        </div>
                      </div>
                    ) : (
                    <div
                      className={`max-w-[85%] sm:max-w-[320px] px-3.5 sm:px-4 py-2.5 rounded-2xl text-sm ${
                        msg.isMe
                          ? "chat-bubble-me bg-[#2563EB] text-white rounded-br-md"
                          : "chat-bubble-them bg-white text-[#1A1A2E] border border-[#E2E8F0] rounded-bl-md"
                      }`}
                    >
                      <p className="break-words">{displayText}</p>
                      <div className={`flex items-center gap-1 mt-1 ${msg.isMe ? "text-blue-200" : "text-[#94A3B8]"}`}>
                        <span className="text-[10px]">
                          {Number(msg.timestamp) > 0 ? timeAgo(Number(msg.timestamp) * 1000) : "now"}
                        </span>
                        {msg.isEncrypted && msg.decrypted && (
                          <Lock className="w-2 h-2 text-[#16A34A]" />
                        )}
                        {msg.isEncrypted && !msg.decrypted && (
                          <AlertCircle className="w-2 h-2 text-[#EF4444]" />
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>



            {/* Private Payment Panel */}
            {showPayment && (
              <div className="border-t border-[#E2E8F0] bg-gradient-to-b from-[#F5F3FF] to-white px-3 py-3">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <EyeOff className="w-4 h-4 text-[#7C3AED]" />
                    <span className="text-sm font-semibold text-[#1A1A2E]">Private USDC Payment</span>
                  </div>
                  <button onClick={() => { setShowPayment(false); setPaymentAmount(""); resetMb(); }} className="p-1 rounded-lg hover:bg-[#E2E8F0] transition-colors">
                    <X className="w-4 h-4 text-[#94A3B8]" />
                  </button>
                </div>

                {/* Amount Input */}
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8] font-medium">$</span>
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00 USDC"
                      step="0.01"
                      min="0"
                      className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-7 pr-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED]"
                      disabled={paymentSending}
                    />
                  </div>
                  <button
                    onClick={handleSendPayment}
                    disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || paymentSending}
                    className="h-10 px-4 rounded-xl text-white text-sm font-medium flex items-center gap-1.5 transition-all disabled:opacity-40 bg-[#7C3AED] hover:bg-[#6D28D9]"
                  >
                    {paymentSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Send
                  </button>
                </div>

                {/* Quick Amounts */}
                <div className="flex gap-1.5 mb-2">
                  {[1, 5, 10, 25].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setPaymentAmount(amt.toString())}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#F1F5F9] hover:border-[#7C3AED]/30 transition-all"
                    >
                      ${amt}
                    </button>
                  ))}
                </div>

                {/* Step Indicator */}
                {paymentSending && (
                  <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[#7C3AED]/5">
                    <Loader2 className="w-3 h-3 text-[#7C3AED] animate-spin flex-shrink-0" />
                    <span className="text-[11px] text-[#7C3AED] font-medium">
                      {mbStep === "building" ? "Building private transaction..."
                        : mbStep === "signing" ? "Sign in your wallet..."
                        : mbStep === "sending" ? "Sending via MagicBlock..."
                        : mbStep === "confirming" ? "Confirming on-chain..."
                        : mbStep === "done" ? "Recording in chat..."
                        : "Processing..."}
                    </span>
                  </div>
                )}

                {/* Privacy Info */}
                <div className="flex items-center gap-1.5 mt-1">
                  <Shield className="w-3 h-3 text-[#94A3B8]" />
                  <span className="text-[10px] text-[#94A3B8]">Private via MagicBlock TEE — amount hidden on-chain</span>
                </div>
              </div>
            )}

            {/* Message Input */}
            <div className="p-2.5 sm:p-3 border-t border-[#E2E8F0] bg-white">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowPayment(!showPayment); resetMb(); }}
                  className={`touch-active w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                    showPayment
                      ? "bg-[#7C3AED] text-white"
                      : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
                  }`}
                  title="Send payment"
                >
                  <DollarSign className="w-4 h-4" />
                </button>
                {/* Always-on private indicator (MagicBlock TEE is the only model). */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#16A34A] text-white"
                  title="Private — all messages run inside the MagicBlock TEE"
                >
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="Private message via MagicBlock TEE 🔒"
                  disabled={sending || creatingChat}
                  className="flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3.5 sm:px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageText.trim() || sending || creatingChat}
                  className="touch-active w-10 h-10 rounded-xl bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8] disabled:opacity-40 transition-all flex-shrink-0"
                >
                  {sending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>

            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7C3AED]/10 to-[#16A34A]/10 flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-8 h-8 text-[#7C3AED]" />
              </div>
              <h3 className="font-bold text-[#1A1A2E] mb-1">
                {chats.length > 0 ? "Select a conversation" : "No contacts yet"}
              </h3>
              <p className="text-sm text-[#64748B]">
                {chats.length > 0
                  ? "Private messaging on Solana 🔒"
                  : "Follow people to start private chats"}
              </p>
              <p className="text-[10px] text-[#94A3B8] mt-2">
                Private via MagicBlock TEE (Private Ephemeral Rollup)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
