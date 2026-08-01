import { workerColorClass, workerIcon } from "@/lib/worker-options";
import { cn } from "@/lib/utils";

/** Square icon/avatar tile used everywhere a worker is represented. */
export function WorkerAvatar({
  icon,
  color,
  avatarUrl,
  className,
}: {
  icon: string | null;
  color: string | null;
  avatarUrl?: string | null;
  className?: string;
}) {
  const Icon = workerIcon(icon);
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-white",
        workerColorClass(color),
        className,
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <Icon className="size-[55%]" />
      )}
    </span>
  );
}
