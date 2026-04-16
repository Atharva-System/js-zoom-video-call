(() => {
  const panel = document.querySelector(".participants-panel");
  const modal = document.getElementById("warning-modal");
  const targetLabel = document.getElementById("warning-target");
  const input = document.getElementById("warning-text");
  const closeBtn = document.getElementById("warning-close");
  const sendBtn = document.getElementById("warning-send");

  const confirmModal = document.getElementById("confirm-modal");
  const confirmLabel = document.getElementById("confirm-target");
  const confirmClose = document.getElementById("confirm-close");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmRemove = document.getElementById("confirm-remove");

  let pendingRemoveUser = null;

  function openModal(user) {
    if (!modal) return;
    targetLabel.textContent = user ? `Send warning to ${user}` : "Send warning";
    modal.classList.remove("closing");
    modal.classList.add("show");
    input.value = "";
    setTimeout(() => input.focus(), 10);
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add("closing");
    setTimeout(() => {
      modal.classList.remove("show", "closing");
    }, 180);
  }

  function openConfirm(user) {
    if (!confirmModal) return;
    pendingRemoveUser = user || null;
    confirmLabel.textContent = user ? `Remove ${user}?` : "Remove user?";
    confirmModal.classList.remove("closing");
    confirmModal.classList.add("show");
  }

  function closeConfirm() {
    if (!confirmModal) return;
    confirmModal.classList.add("closing");
    setTimeout(() => {
      confirmModal.classList.remove("show", "closing");
    }, 180);
  }

  panel?.addEventListener("click", async (e) => {
    const warning = e.target.closest(".warning");
    if (warning) {
      const user =
        warning.dataset.user ||
        warning.closest(".participant-card")?.querySelector(".name")
          ?.textContent;
      openModal(user?.trim());
      return;
    }

    const remove = e.target.closest(".remove");

    if (remove) {
      const user =
        remove.dataset.user ||
        remove.closest(".participant-card")?.querySelector(".name")
          ?.textContent;
      openConfirm(user?.trim());
      return;
    }

    // const chat = e.target.closest(".chat");
    // if (chat) {
    //   const { isConfirmed } = await showConfirmDialog({
    //     title: "Are you sure?",
    //   });
    //   console.log("isConfirmed ", isConfirmed);
    //   if (isConfirmed) {
    //     const { isConfirmed, value } = await showInputDialog({
    //       title: "Are you sure?",
    //       inputPlaceholder: "Write here...",
    //     });
    //     console.log("isConfirmed =>", isConfirmed);
    //     console.log("value =>", value);
    //   }
    // }
  });

  closeBtn?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  sendBtn?.addEventListener("click", () => {
    // Placeholder: wire to backend/SDK as needed
    console.log("Warning sent:", input.value);
    closeModal();
  });

  confirmClose?.addEventListener("click", closeConfirm);
  confirmCancel?.addEventListener("click", closeConfirm);
  confirmModal?.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeConfirm();
  });
  confirmRemove?.addEventListener("click", () => {
    console.log("Remove user:", pendingRemoveUser);
    closeConfirm();
  });
})();

async function showConfirmDialog({
  title = "Are you sure?",
  confirmButtonText = "Confirm",
  cancelButtonText = "Cancel",
}) {
  const { isConfirmed } = await Swal.fire({
    title,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    allowOutsideClick: false,
    allowEscapeKey: false,
    confirmButtonColor: "#FA5A0B",
    cancelButtonColor: "#949090",
  });
  return { isConfirmed };
}

async function showInputDialog({
  title = "Are you sure?",
  inputPlaceholder = "Write here...",
  confirmButtonText = "Yes",
  cancelButtonText = "Cancel",
}) {
  const { isConfirmed, value } = await Swal.fire({
    title,
    input: "text",
    inputPlaceholder,
    showCancelButton: true,
    confirmButtonText,
    allowOutsideClick: false,
    allowEscapeKey: false,
    cancelButtonText,
    confirmButtonColor: "#FA5A0B",
    cancelButtonColor: "#949090",
  });

  return { isConfirmed, value };
}
