export const dom = {
  lobbyScreen: document.getElementById("lobbyScreen"),
  gameScreen: document.getElementById("gameScreen"),
  profileBox: document.getElementById("profileBox"),
  lobbyList: document.getElementById("lobbyList"),
  openCreateLobbyBtn: document.getElementById("openCreateLobbyBtn"),
  createLobbyModal: document.getElementById("createLobbyModal"),
  closeLobbyModalBtn: document.getElementById("closeLobbyModalBtn"),
  lobbyForm: document.getElementById("lobbyForm"),
  lobbyNameInput: document.getElementById("lobbyNameInput"),
  gridSizeInput: document.getElementById("gridSizeInput"),
  refreshModeInput: document.getElementById("refreshModeInput"),
  refreshTimeField: document.getElementById("refreshTimeField"),
  refreshTimeInput: document.getElementById("refreshTimeInput"),
  quickRefreshField: document.getElementById("quickRefreshField"),
  quickRefreshInput: document.getElementById("quickRefreshInput"),
  shrinkToggleInput: document.getElementById("shrinkToggleInput"),
  shrinkIntervalField: document.getElementById("shrinkIntervalField"),
  shrinkIntervalInput: document.getElementById("shrinkIntervalInput"),
  shrinkIntervalValue: document.getElementById("shrinkIntervalValue"),
  testLobbyToggleInput: document.getElementById("testLobbyToggleInput"),
  testPlayerCountField: document.getElementById("testPlayerCountField"),
  testPlayerCountInput: document.getElementById("testPlayerCountInput"),
  testPlayerCountValue: document.getElementById("testPlayerCountValue"),
  profileNameInput: document.getElementById("profileNameInput"),
  profileIconInput: document.getElementById("profileIconInput"),
  profileColorInput: document.getElementById("profileColorInput"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  returnLobbyBtn: document.getElementById("returnLobbyBtn"),
  board: document.getElementById("board"),
  lobbyNameText: document.getElementById("lobbyNameText"),
  zoneDisplayText: document.getElementById("zoneDisplayText"),
  refreshTimerText: document.getElementById("refreshTimerText"),
  zoneCountdownText: document.getElementById("zoneCountdownText"),
  playerCard: document.getElementById("playerCard"),
  playerRoster: document.getElementById("playerRoster"),
  logList: document.getElementById("logList"),
  forfeitBtn: document.getElementById("forfeitBtn"),
  declareWinBtn: document.getElementById("declareWinBtn"),
  forfeitModal: document.getElementById("forfeitModal"),
  cancelForfeitBtn: document.getElementById("cancelForfeitBtn"),
  confirmForfeitBtn: document.getElementById("confirmForfeitBtn"),
  upgradeModal: document.getElementById("upgradeModal"),
  cancelUpgradeBtn: document.getElementById("cancelUpgradeBtn"),
  confirmUpgradeBtn: document.getElementById("confirmUpgradeBtn"),
  declareWinModal: document.getElementById("declareWinModal"),
  cancelWinBtn: document.getElementById("cancelWinBtn"),
  confirmWinBtn: document.getElementById("confirmWinBtn")
};

export function setModalVisibility(modal, visible) {
  if (!modal) {
    return;
  }

  modal.classList.toggle("hidden", !visible);
  modal.setAttribute("aria-hidden", String(!visible));
}
