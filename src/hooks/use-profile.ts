import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { profileService } from "@/services/profile-service";

/** Reads the authenticated user's row from the `profiles` table. */
export function useProfile() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => profileService.get(user!.id),
  });

  const fullName = data?.full_name ?? (user?.user_metadata?.["full_name"] as string | undefined) ?? "";
  const email = data?.email ?? user?.email ?? "";
  const source = fullName || email;

  return {
    profile: data ?? null,
    fullName,
    email,
    avatarUrl: data?.avatar_url ?? null,
    initials: source.slice(0, 2).toUpperCase() || "ZX",
  };
}
