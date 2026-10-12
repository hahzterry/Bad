import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { Post, ChatConversation, ChatMessage, Payment, UserProfile } from "@/types";

/* ───────── Notification Types ───────── */
export interface AppNotification {
  id: string;
  type: "like" | "comment" | "repost" | "follow" | "reaction" | "tip" | "mention";
  /** Who triggered it */
  actorAddress: string;
  actorName: string;
  actorAvatarUrl?: string;
  /** The post involved (if any) */
  postKey?: string;
  postPreview?: string;
  /** Extra info */
  reactionEmoji?: string;
  commentText?: string;
  tipAmount?: number;
  timestamp: number;
  read: boolean;
}

interface AppState {
  // User
  currentUser: UserProfile | null;
  isConnected: boolean;
  setCurrentUser: (user: UserProfile | null) => void;
  setConnected: (connected: boolean) => void;

  // Feed
  posts: Post[];
  addPost: (content: string) => string; // returns post id
  removePost: (postId: string) => void;
  toggleLike: (postId: string) => void;
  addComment: (postId: string, content: string) => void;

  // Chat
  conversations: ChatConversation[];
  messages: Record<string, ChatMessage[]>;
  addConversation: (conv: ChatConversation) => void;
  sendMessage: (conversationId: string, content: string) => void;
  sendPaymentMessage: (conversationId: string, amount: number, token: string) => void;

  // Payments
  payments: Payment[];
  addPayment: (payment: Payment) => void;
  updatePaymentStatus: (paymentId: string, status: Payment["status"]) => void;

  // On-chain post interactions
  onChainComments: Record<string, { id: string; author: string; displayName: string; content: string; timestamp: number }[]>;
  addOnChainComment: (postKey: string, author: string, displayName: string, content: string) => void;
  likedPosts: string[]; // array of post publicKeys the user has liked
  addLikedPost: (postKey: string) => void;
  setLikedPosts: (postKeys: string[]) => void;

  // Paid post unlocks
  unlockedPosts: string[]; // post publicKeys the user has paid to unlock
  addUnlockedPost: (postKey: string) => void;
  postReceipts: Record<string, string>; // postKey -> x402 receiptId
  addPostReceipt: (postKey: string, receiptId: string) => void;

  // Post tips
  postTips: Record<string, { totalAmount: number; tipCount: number; myTip: number }>;
  addPostTip: (postKey: string, amount: number) => void;

  // Profile viewing
  viewingProfile: string | null; // wallet address of user being viewed, null = own profile
  setViewingProfile: (addr: string | null) => void;
  /** Navigate to a user's profile: sets viewingProfile and switches to profile tab */
  navigateToProfile: (walletAddress: string) => void;

  // Focus a specific post (from notification click)
  focusPostKey: string | null;
  setFocusPostKey: (key: string | null) => void;

  // Active tab
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Theme
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;

  // Active chat
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;

  // Notifications
  notifications: AppNotification[];
  addNotification: (n: AppNotification) => void;
  addNotifications: (ns: AppNotification[]) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadNotificationCount: () => number;
  /** Set of on-chain keys we've already generated notifications for */
  seenNotificationKeys: string[];
  addSeenNotificationKeys: (keys: string[]) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  // User
  currentUser: null,
  isConnected: false,
  setCurrentUser: (user) => set({ currentUser: user }),
  setConnected: (connected) => set({ isConnected: connected }),

  // Feed
  posts: [],
  addPost: (content) => {
    const user = get().currentUser;
    if (!user) return "";
    const newPost: Post = {
      id: uuidv4(),
      author: user,
      content,
      likes: 0,
      comments: [],
      createdAt: Date.now(),
      isLiked: false,
    };
    set((state) => ({ posts: [newPost, ...state.posts] }));
    return newPost.id;
  },
  removePost: (postId) => set((state) => ({ posts: state.posts.filter((p) => p.id !== postId) })),
  toggleLike: (postId) =>
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likes: p.isLiked ? p.likes - 1 : p.likes + 1 }
          : p
      ),
    })),
  addComment: (postId, content) => {
    const user = get().currentUser;
    if (!user) return;
    const comment = { id: uuidv4(), author: user, content, createdAt: Date.now() };
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId ? { ...p, comments: [...p.comments, comment] } : p
      ),
    }));
  },

  // Chat
  conversations: [],
  messages: {},
  addConversation: (conv) =>
    set((state) => {
      if (state.conversations.find((c) => c.id === conv.id)) return state;
      return { conversations: [conv, ...state.conversations] };
    }),
  sendMessage: (conversationId, content) => {
    const msg: ChatMessage = {
      id: uuidv4(),
      sender: "me",
      content,
      timestamp: Date.now(),
      isPayment: false,
      isPrivate: true,
    };
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), msg],
      },
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: content, lastMessageTime: Date.now(), unreadCount: 0 }
          : c
      ),
    }));
  },
  sendPaymentMessage: (conversationId, amount, token) => {
    const paymentMsg: ChatMessage = {
      id: uuidv4(),
      sender: "me",
      content: "",
      timestamp: Date.now(),
      isPayment: true,
      paymentAmount: amount,
      paymentToken: token,
      paymentStatus: "completed",
      isPrivate: true,
    };
    const conv = get().conversations.find((c) => c.id === conversationId);
    const payment: Payment = {
      id: uuidv4(),
      sender: "me",
      recipient: conv?.participant.publicKey || "",
      amount,
      token,
      status: "completed",
      isPrivate: true,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), paymentMsg],
      },
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: `Sent ${amount} ${token}`, lastMessageTime: Date.now() }
          : c
      ),
      payments: [payment, ...state.payments],
    }));
  },

  // Payments
  payments: [],
  addPayment: (payment) => set((state) => ({ payments: [payment, ...state.payments] })),
  updatePaymentStatus: (paymentId, status) =>
    set((state) => ({
      payments: state.payments.map((p) => (p.id === paymentId ? { ...p, status } : p)),
    })),

  // On-chain post interactions
  onChainComments: {},
  addOnChainComment: (postKey, author, displayName, content) => {
    const comment = { id: Date.now().toString() + Math.random().toString(36).slice(2), author, displayName, content, timestamp: Date.now() };
    set((state) => ({
      onChainComments: {
        ...state.onChainComments,
        [postKey]: [...(state.onChainComments[postKey] || []), comment],
      },
    }));
  },
  likedPosts: [],
  addLikedPost: (postKey) => set((state) => ({
    likedPosts: state.likedPosts.includes(postKey) ? state.likedPosts : [...state.likedPosts, postKey],
  })),
  setLikedPosts: (postKeys) => set((state) => ({
    likedPosts: [...new Set([...state.likedPosts, ...postKeys])],
  })),

  // Paid post unlocks
  unlockedPosts: [],
  addUnlockedPost: (postKey) => set((state) => ({
    unlockedPosts: state.unlockedPosts.includes(postKey) ? state.unlockedPosts : [...state.unlockedPosts, postKey],
  })),
  postReceipts: {},
  addPostReceipt: (postKey, receiptId) => set((state) => ({
    postReceipts: { ...state.postReceipts, [postKey]: receiptId },
  })),

  // Post tips
  postTips: {},
  addPostTip: (postKey, amount) => set((state) => {
    const existing = state.postTips[postKey] || { totalAmount: 0, tipCount: 0, myTip: 0 };
    return {
      postTips: {
        ...state.postTips,
        [postKey]: {
          totalAmount: existing.totalAmount + amount,
          tipCount: existing.tipCount + 1,
          myTip: existing.myTip + amount,
        },
      },
    };
  }),

  // Profile viewing
  viewingProfile: null,
  setViewingProfile: (addr) => set({ viewingProfile: addr }),
  navigateToProfile: (walletAddress) => set({ viewingProfile: walletAddress, activeTab: "profile" }),

  // Focus post (from notification click)
  focusPostKey: null,
  setFocusPostKey: (key) => set({ focusPostKey: key }),

  // Navigation
  activeTab: "feed",
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Theme
  theme: "light",
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),

  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),

  // Notifications
  notifications: [],
  addNotification: (n) => set((state) => {
    const merged = [n, ...state.notifications];
    merged.sort((a, b) => b.timestamp - a.timestamp);
    return { notifications: merged.slice(0, 100) };
  }),
  addNotifications: (ns) => set((state) => {
    const merged = [...ns, ...state.notifications];
    // Sort newest first by timestamp
    merged.sort((a, b) => b.timestamp - a.timestamp);
    return { notifications: merged.slice(0, 100) };
  }),
  markNotificationRead: (id) => set((state) => ({
    notifications: state.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
  })),
  markAllNotificationsRead: () => set((state) => ({
    notifications: state.notifications.map((n) => ({ ...n, read: true })),
  })),
  unreadNotificationCount: () => get().notifications.filter((n) => !n.read).length,
  seenNotificationKeys: [],
  addSeenNotificationKeys: (keys) => set((state) => ({
    seenNotificationKeys: [...new Set([...state.seenNotificationKeys, ...keys])].slice(-2000),
  })),
    }),
    {
      name: "shadowspace-storage",
      partialize: (state) => ({
        posts: state.posts,
        conversations: state.conversations,
        messages: state.messages,
        payments: state.payments,
        onChainComments: state.onChainComments,
        likedPosts: state.likedPosts,
        unlockedPosts: state.unlockedPosts,
        postReceipts: state.postReceipts,
        postTips: state.postTips,
        notifications: state.notifications,
        seenNotificationKeys: state.seenNotificationKeys,
        theme: state.theme,
      }),
    }
  )
);
