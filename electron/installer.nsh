; Orbit 星账 · NSIS 安装向导扩展
;
; 这一版按 Knote 的安装器思路重做，要点三条：
;   1) 检测到本机已安装 ⇒ 给一个明确的「更新」选项，默认就在原位置更新，
;      一路「下一步」即可 —— 不需要重新挑安装路径；
;   2) **不再让用户选账本数据目录**。账本位置由应用自己管（默认 %APPDATA%\Orbit 星账，
;      可改 data-path.txt），安装器不碰它，自然也不会改错它；
;   3) 更新时**抑制 electron-builder 调用旧卸载器**。旧卸载器会 `RMDir /r $INSTDIR`，
;      把用户放在安装目录里的东西（包括就把账本放这儿的用户）一并删掉；
;      抑制之后新载荷是覆盖式释放，原地替换程序文件，目录里的其它内容原样留着。
;
; 时机：抑制动作必须早于 `uninstallOldVersion`，而 customInit 属于 .onInit 阶段，
; 是整个安装流程里最早的可插入点，正好满足（放在 customInstall 里就晚了 —— 那时
; 旧卸载器已经跑完，账本已经没了，实测确认过）。
;
; 注意：NSIS 是两阶段构建（先卸载器、后安装器），本文件在两个阶段都会被包含。
; 自定义页与函数只属于安装器，必须用 !ifndef BUILD_UNINSTALLER 围住 ——
; 否则卸载器阶段会出现「函数未被引用」警告，而 electron-builder 把警告当错误。

!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define ORBIT_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!define ORBIT_EXE "Orbit 星账.exe"

!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"

Var ExistingDir      ; 检测到的旧安装目录（空＝本机没装过）
Var InstallChoice    ; "update"＝原地更新 / "move"＝换位置
Var MoveDir          ; 换位置时的目标目录
Var ChoicePage
Var ChoiceUpdate
Var ChoiceMove
Var ChoiceClose
Var DestPage
Var DestField
Var DestBrowse

; 找本机已有的 Orbit 安装目录。三级兜底，每一级都要真的看到 exe 才认（防误判）：
;   ① 自己写的 InstallLocation（1.0.5 起会写）
;   ② 注册表里的 UninstallString 反推目录（1.0.0~1.0.4 只写了这个）
;   ③ $INSTDIR 的默认值（per-user 安装即 $LOCALAPPDATA\Programs\Orbit 星账）
Function FindExistingInstall
  StrCpy $ExistingDir ""

  ReadRegStr $0 SHELL_CONTEXT "${ORBIT_UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
    IfFileExists "$0\${ORBIT_EXE}" 0 inLocDone
    StrCpy $ExistingDir "$0"
    Goto found
    inLocDone:
  ${EndIf}

  ReadRegStr $0 SHELL_CONTEXT "${ORBIT_UNINSTALL_KEY}" "UninstallString"
  ${If} $0 != ""
    StrCpy $0 "$0" "" 1          ; 去掉开头的引号
    StrCpy $0 "$0" -1            ; 再去掉结尾的引号
    ${GetParent} "$0" $1
    IfFileExists "$1\${ORBIT_EXE}" 0 unStrDone
    StrCpy $ExistingDir "$1"
    Goto found
    unStrDone:
  ${EndIf}

  ${If} $ExistingDir == ""
    IfFileExists "$INSTDIR\${ORBIT_EXE}" 0 noInstall
    StrCpy $ExistingDir "$INSTDIR"
  ${EndIf}
  noInstall:

  found:
  ${If} $ExistingDir != ""
    StrCpy $INSTDIR "$ExistingDir"
    StrCpy $InstallChoice "update"
  ${EndIf}
FunctionEnd

; 整个安装流程里最早的一步（.onInit）：检测已装版本 + 挡住旧卸载器。
; 那句 DeleteRegValue 是关键：electron-builder 升级时靠注册表里的 UninstallString
; 去调用旧卸载器，而旧卸载器会 `RMDir /r $INSTDIR`。删掉它，新载荷就直接覆盖上去，
; 用户放在安装目录里的东西原地不动。安装结束前 electron-builder 会重新写回这些值。
!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call FindExistingInstall
    DeleteRegValue SHELL_CONTEXT "${ORBIT_UNINSTALL_KEY}" "UninstallString"
    DeleteRegValue SHELL_CONTEXT "${ORBIT_UNINSTALL_KEY}" "QuietUninstallString"
    DeleteRegValue HKCU "${ORBIT_UNINSTALL_KEY}" "UninstallString"
    DeleteRegValue HKCU "${ORBIT_UNINSTALL_KEY}" "QuietUninstallString"
  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom ChoicePageCreate ChoicePageLeave
  Page custom DestPageCreate DestPageLeave
!macroend

; 「检测到已安装」这一页只在真的装过时出现；没有就直接跳过（全新安装看不到它）。
Function ChoicePageCreate
  ${If} $ExistingDir == ""
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $ChoicePage
  ${If} $ChoicePage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "检测到本机已安装 Orbit 星账，请选择处理方式："
  Pop $0
  CreateFont $1 "Segoe UI" 10 600
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 22u 100% 14u "现有位置：$ExistingDir"
  Pop $0
  ${NSD_CreateLabel} 0 38u 100% 14u "账本数据不在这个目录里，两种情况都不会动它。"
  Pop $0
  SetCtlColors $0 0x6B7280 transparent

  ${NSD_CreateRadioButton} 0 60u 100% 17u "1. 在原有位置更新（推荐）"
  Pop $ChoiceUpdate
  ${NSD_Check} $ChoiceUpdate
  ${NSD_CreateRadioButton} 0 81u 100% 17u "2. 换一个位置安装"
  Pop $ChoiceMove
  ${NSD_CreateRadioButton} 0 102u 100% 17u "3. 关闭安装程序"
  Pop $ChoiceClose

  nsDialogs::Show
FunctionEnd

Function ChoicePageLeave
  ${If} $ExistingDir == ""
    Return
  ${EndIf}

  ${NSD_GetState} $ChoiceClose $0
  ${If} $0 == ${BST_CHECKED}
    Quit
  ${EndIf}

  ${NSD_GetState} $ChoiceMove $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $InstallChoice "move"
  ${Else}
    StrCpy $InstallChoice "update"
    StrCpy $INSTDIR "$ExistingDir"      ; 原地更新：路径一个字都不变
  ${EndIf}
FunctionEnd

; 位置选择页只在「换位置」时出现 —— 选更新的人看不到这一页，也就无从「重新选路径」。
Function DestPageCreate
  ${If} $InstallChoice != "move"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $DestPage
  ${If} $DestPage == error
    Abort
  ${EndIf}

  StrCpy $MoveDir "$INSTDIR"
  ${NSD_CreateLabel} 0 0 100% 18u "选择新的安装位置（原来的 $ExistingDir 会保留，不会删除）："
  Pop $0
  ${NSD_CreateText} 0 30u 77% 14u "$MoveDir"
  Pop $DestField
  ${NSD_CreateBrowseButton} 80% 29u 20% 16u "浏览…"
  Pop $DestBrowse
  ${NSD_OnClick} $DestBrowse DestBrowseDir

  nsDialogs::Show
FunctionEnd

Function DestBrowseDir
  nsDialogs::SelectFolderDialog "选择安装位置" "$MoveDir"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DestField "$0"
  ${EndIf}
FunctionEnd

Function DestPageLeave
  ${NSD_GetText} $DestField $MoveDir
  ${If} $MoveDir == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择安装位置。"
    Abort
  ${EndIf}
  ; 盘符根目录不是合法的程序目录：D:\ 自动变成 D:\Orbit 星账
  ${GetRoot} "$MoveDir" $0
  ${If} $MoveDir == $0
    StrCpy $MoveDir "$0Orbit 星账"
    ${NSD_SetText} $DestField "$MoveDir"
  ${EndIf}
  StrCpy $INSTDIR "$MoveDir"
FunctionEnd

!endif

; 记下安装位置：下次更新靠它一眼找到你（同时也给「换位置」留了干净的注册信息）。
; 账本数据目录不在这里写 —— 安装器根本不碰它，已有配置保持原样。
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${ORBIT_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
!macroend
