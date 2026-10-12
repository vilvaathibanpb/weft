import type { McpStatus } from "../lib/types";
import { STATUS_LABEL } from "../lib/types";

export function StatusPill({ status }: { status: McpStatus }) {
  return (
    <span className={`pill ${status}`}>
      <span className="led" />
      {STATUS_LABEL[status]}
    </span>
  );
}
