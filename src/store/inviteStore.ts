import { create } from "zustand";
import {
  claimInvite,
  fetchInvites,
  getVisitorId,
  moderateInvite,
  submitInvite,
} from "@/api/invites";
import type {
  ClaimResult,
  InviteEntry,
  InviteSubmissionInput,
  ModerationAction,
} from "@/types/invite";

interface InviteState {
  invites: InviteEntry[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  submit: (input: InviteSubmissionInput) => Promise<InviteEntry>;
  moderate: (id: string, action: ModerationAction, reason?: string) => Promise<void>;
  claim: (id: string) => Promise<ClaimResult>;
}

export const useInviteStore = create<InviteState>((set) => ({
  invites: [],
  loading: false,
  loaded: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const invites = await fetchInvites();
      set({ invites, loading: false, loaded: true });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : "加载失败",
      });
    }
  },

  submit: async (input) => {
    const entry = await submitInvite(input);
    set((state) => ({ invites: [entry, ...state.invites] }));
    return entry;
  },

  moderate: async (id, action, reason) => {
    const updated = await moderateInvite(id, action, reason);
    if (!updated) return;
    set((state) => ({
      invites: state.invites.map((item) => (item.id === id ? updated : item)),
    }));
  },

  claim: async (id) => {
    const result = await claimInvite(id, getVisitorId());
    // 领取可能会把状态变为 exhausted，重新拉取保持最新
    if (result.ok) {
      const invites = await fetchInvites();
      set({ invites });
    }
    return result;
  },
}));
