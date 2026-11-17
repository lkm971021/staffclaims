import type { Branch, User } from "@prisma/client";
import { saveUserAction } from "@/app/actions/admin";

export function UserForm({ user, branches }: { user?: User | null; branches: Branch[] }) {
  const f = (k: keyof User) => (user?.[k] as string | null | undefined) ?? "";
  const field = (name: string, label: string, def: string, opts: { type?: string; required?: boolean; ph?: string } = {}) => (
    <div><label className="label" htmlFor={name}>{label}{opts.required ? " *" : ""}</label><input id={name} name={name} type={opts.type ?? "text"} defaultValue={def} required={opts.required} placeholder={opts.ph} className="input" /></div>
  );
  return (
    <form action={saveUserAction} className="card space-y-4 p-4">
      {user ? <input type="hidden" name="id" value={user.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("employeeNo", "Employee ID", f("employeeNo"), { required: true, ph: "00011" })}
        {field("name", "Full name (as per NRIC)", f("name"), { required: true })}
        {field("nickName", "Preferred / English name", f("nickName"))}
        {field("email", "Email (used for sign-in)", f("email"), { type: "email", required: true })}
        {field("phone", "Phone", f("phone"))}
        <div>
          <label className="label" htmlFor="branchId">Branch</label>
          <select id="branchId" name="branchId" defaultValue={f("branchId")} className="input"><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </div>
        {field("department", "Department", f("department"))}
        {field("position", "Position", f("position"))}
        {field("nric", "NRIC No. (restricted)", f("nric"))}
        {field("tin", "TIN No. (restricted)", f("tin"))}
      </div>
      <div>
        <div className="label">Roles</div>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["STAFF", "FINANCE", "DIRECTOR", "ADMIN"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2"><input type="checkbox" name={`role_${r}`} defaultChecked={user ? user.roles.includes(r) : r === "STAFF"} className="h-4 w-4" />{r === "STAFF" ? "Staff (can submit claims)" : r === "FINANCE" ? "Finance & Accounting" : r === "DIRECTOR" ? "Service Director (approver)" : "System administrator"}</label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("password", user ? "Set new password (optional)" : "Initial password (optional if using Google sign-in)", "", { type: "password", ph: "at least 10 characters" })}
        <div className="flex flex-col justify-end gap-2 text-sm">
          {user ? <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={user.active} className="h-4 w-4" />Account active (untick to deactivate — history is kept)</label> : <input type="hidden" name="active" value="on" />}
        </div>
      </div>
      <button className="btn-primary">Save user</button>
    </form>
  );
}
