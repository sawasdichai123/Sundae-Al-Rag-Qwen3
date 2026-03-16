/**
 * CreateOrgPage — User creates their own organization after approval
 *
 * Also shows pending invitations that the user can accept.
 */

import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { useOrgStore } from "../store/orgStore";
import { orgApi } from "../api/endpoints";
import type { MyInvitation } from "../types";
import Spinner from "../components/Spinner";

export default function CreateOrgPage() {
    const navigate = useNavigate();
    const toast = useToastStore((s) => s.addToast);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

    const [orgName, setOrgName] = useState("");
    const [creating, setCreating] = useState(false);
    const [invitations, setInvitations] = useState<MyInvitation[]>([]);
    const [loadingInvites, setLoadingInvites] = useState(true);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);

    // No role guard needed — any approved user can create an org

    // Load pending invitations
    useEffect(() => {
        (async () => {
            try {
                const { data } = await orgApi.myInvitations();
                setInvitations((data || []).filter((inv: MyInvitation) => inv.status === "pending"));
            } catch (err) {
                console.error("[CreateOrg] Failed to load invitations:", err);
            } finally {
                setLoadingInvites(false);
            }
        })();
    }, []);

    const handleCreate = async (e: FormEvent) => {
        e.preventDefault();
        if (!orgName.trim()) return;
        setCreating(true);
        try {
            await orgApi.create(orgName.trim());
            toast("success", "สร้างองค์กรสำเร็จ");
            await fetchOrgs();
            navigate("/", { replace: true });
        } catch (err: unknown) {
            console.error("[CreateOrg] Failed:", err);
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "สร้างองค์กรไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setCreating(false);
        }
    };

    const handleAccept = async (invitationId: string) => {
        setAcceptingId(invitationId);
        try {
            await orgApi.acceptInvitation(invitationId);
            toast("success", "เข้าร่วมองค์กรสำเร็จ");
            await fetchOrgs();
            navigate("/", { replace: true });
        } catch (err: unknown) {
            console.error("[CreateOrg] Accept failed:", err);
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "เข้าร่วมองค์กรไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setAcceptingId(null);
        }
    };

    return (
        <div className="animate-fade-in max-w-lg mx-auto">
            <div className="mb-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center text-3xl mx-auto mb-4">
                    🏢
                </div>
                <h1 className="text-2xl font-bold text-steel-900">สร้างองค์กร</h1>
                <p className="text-sm text-steel-500 mt-1">
                    สร้างองค์กรใหม่หรือเข้าร่วมองค์กรที่ได้รับเชิญ
                </p>
            </div>

            {/* Pending Invitations */}
            {!loadingInvites && invitations.length > 0 && (
                <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">คำเชิญที่รอดำเนินการ</h2>
                    </div>
                    <div className="divide-y divide-steel-100">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="px-6 py-4 flex items-center gap-4">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">{inv.org_name}</p>
                                    <p className="text-xs text-steel-400">เชิญไปที่ {inv.invited_email}</p>
                                </div>
                                <button
                                    onClick={() => handleAccept(inv.id)}
                                    disabled={acceptingId === inv.id}
                                    className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                    {acceptingId === inv.id ? "กำลัง..." : "เข้าร่วม"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Create Org Form */}
            <div className="bg-white rounded-2xl border border-steel-100 p-6">
                <h2 className="text-sm font-semibold text-steel-800 mb-4">สร้างองค์กรใหม่</h2>
                <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                        <label htmlFor="org-name" className="block text-xs font-medium text-steel-600 mb-1.5">
                            ชื่อองค์กร
                        </label>
                        <input
                            id="org-name"
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            placeholder="บริษัท ABC จำกัด"
                            required
                            disabled={creating}
                            autoFocus
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={creating || !orgName.trim()}
                        className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {creating ? <><Spinner /> กำลังสร้าง...</> : "สร้างองค์กร"}
                    </button>
                </form>
            </div>
        </div>
    );
}
