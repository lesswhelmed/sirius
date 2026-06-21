// The signed-in user's weekly AI-generation budget, read from the server (the
// authoritative enforcer). Pro users get null limits (unlimited). Used by the
// usage meter + the pre-submit paywall prompt.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type AiUsage = {
  used: number;
  limit: number | null;
  remaining: number | null;
  isPro: boolean;
  resetsAt: string | null;
};

export function useAiUsage() {
  return useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => apiGet<AiUsage>("/api/app/usage"),
    staleTime: 30_000,
  });
}
