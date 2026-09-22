import { useEffect, useState } from "react";
import { MessageCircleMore, X } from "lucide-react";

// 客服入口：二维码放在 public/kefu-qr.png（企业微信"联系我"二维码），说明文字由 KEFU_NOTE 环境变量给
export const KEFU_QR = "/kefu-qr.png";

export function useKefuNote(): string {
  const [note, setNote] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((j: { kefuNote?: string }) => setNote(j.kefuNote || ""))
      .catch(() => {});
  }, []);
  return note;
}

export function KefuModal({ open, onClose, note }: { open: boolean; onClose: () => void; note?: string }) {
  const [broken, setBroken] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center text-[#2b2320] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-black">联系客服</span>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[#2b2320]/5" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-auto mt-4 flex h-56 w-56 items-center justify-center overflow-hidden rounded-xl border border-[#2b2320]/10 bg-[#f6f1e6]">
          {broken ? (
            <span className="px-4 text-xs text-[#2b2320]/50">客服二维码待上传</span>
          ) : (
            <img src={KEFU_QR} alt="客服微信二维码" className="h-full w-full object-contain" onError={() => setBroken(true)} />
          )}
        </div>
        <p className="mt-4 text-sm leading-6 text-[#2b2320]/75">
          {note || "微信扫码或长按识别，添加客服领取口令、续期或反馈问题。"}
        </p>
      </div>
    </div>
  );
}

export function KefuButton({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const note = useKefuNote();
  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {children ?? (
          <>
            <MessageCircleMore className="h-4 w-4" /> 联系客服
          </>
        )}
      </button>
      <KefuModal open={open} onClose={() => setOpen(false)} note={note} />
    </>
  );
}
