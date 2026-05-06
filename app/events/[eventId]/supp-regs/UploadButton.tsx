"use client";

export function UploadButton({
  action,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
}) {
  return (
    <form action={action}>
      <label className="rc-btn rc-btn-primary text-sm cursor-pointer">
        {label}
        <input
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              (e.target.closest("form") as HTMLFormElement).requestSubmit();
            }
          }}
        />
      </label>
    </form>
  );
}
