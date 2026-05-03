import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checklistInstances, events, vehicles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";
import { KIND_LABEL, loadChecklistState } from "@/lib/checklists";

type Params = Promise<{ instanceId: string }>;

export default async function ChecklistPrintPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { instanceId } = await params;

  const [meta] = await db
    .select({
      id: checklistInstances.id,
      kind: checklistInstances.kind,
      name: checklistInstances.name,
      eventName: events.name,
      eventDate: events.eventDate,
      vehicleName: vehicles.name,
    })
    .from(checklistInstances)
    .innerJoin(events, eq(events.id, checklistInstances.eventId))
    .innerJoin(vehicles, eq(vehicles.id, checklistInstances.vehicleId))
    .where(
      and(
        eq(checklistInstances.id, instanceId),
        eq(checklistInstances.teamId, me.teamId),
      ),
    )
    .limit(1);
  if (!meta) notFound();

  const state = await loadChecklistState(me.teamId, instanceId);

  return (
    <main className="print-page mx-auto max-w-3xl bg-white px-10 py-10 text-black">
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; }
        }
        .print-page { color: #000; }
        .print-page table { width: 100%; border-collapse: collapse; }
        .print-page th, .print-page td {
          border: 1px solid #999;
          padding: 6px 8px;
          font-size: 12px;
          text-align: left;
          vertical-align: top;
        }
        .print-page th { background: #f3f4f6; font-weight: 600; }
      `}</style>

      <header className="mb-6 flex items-start justify-between border-b border-gray-300 pb-4">
        <div>
          <h1 className="text-2xl font-bold">{KIND_LABEL[meta.kind]}</h1>
          <p className="text-sm">
            {meta.vehicleName} · {meta.eventName} · {meta.eventDate}
          </p>
        </div>
        <div className="text-right text-xs">
          <div>{state.signedItems} / {state.totalItems} signed</div>
          <div>{state.percentage}% complete</div>
        </div>
      </header>

      <table>
        <thead>
          <tr>
            <th style={{ width: "3%" }}>#</th>
            <th style={{ width: "47%" }}>Item</th>
            <th style={{ width: "20%" }}>Signed by</th>
            <th style={{ width: "30%" }}>Date / signature</th>
          </tr>
        </thead>
        <tbody>
          {state.items.map(({ item, signoff }, idx) => (
            <tr key={item.id}>
              <td>{idx + 1}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{item.label}</div>
                {item.description ? (
                  <div style={{ fontSize: 11, color: "#555" }}>
                    {item.description}
                  </div>
                ) : null}
              </td>
              <td>
                {signoff ? (
                  signoff.userName
                ) : (
                  <span style={{ color: "#bbb" }}>____________________</span>
                )}
              </td>
              <td>
                {signoff
                  ? signoff.signedAt.toISOString().slice(0, 10)
                  : ""}
                {!signoff ? (
                  <div
                    style={{
                      borderBottom: "1px solid #999",
                      height: "1.2em",
                      marginTop: 6,
                    }}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-8 text-xs text-gray-600">
        Printed from Rally Commander on {new Date().toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
