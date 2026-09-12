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
Var DataDirValue     ; 本轮要写进配置的数据目录；置空＝保持现状、不动配置文件
Var DataDirEdit      ; 数据目录输入框
Var PrevDataDir      ; 上次配置里记的数据目录
Var HasPrevDataDir   ; 是否已有配置文件（"1"/"0"）

; 读上次写下的数据目录。**覆盖更新必须沿用它** —— 用户升级后应用要回到原来那本账，
; 而不是跑去默认位置新建一个空库（这条是 1.1.6 事故的根因：当时我把这个读取删掉了）。
Function ReadPrevDataDir
  StrCpy $PrevDataDir ""
  StrCpy $HasPrevDataDir "0"
  IfFileExists "$APPDATA\Orbit 星账\data-path.txt" 0 rpdDone
  StrCpy $HasPrevDataDir "1"
  FileOpen $0 "$APPDATA\Orbit 星账\data-path.txt" r
  IfErrors rpdDone
  FileReadByte $0 $1        ; BOM 第 1 字节
  FileReadByte $0 $2        ; BOM 第 2 字节
  ${If} $1 == 255
  ${AndIf} $2 == 254
    FileReadUTF16LE $0 $PrevDataDir
  ${EndIf}
  FileClose $0
  rpdDone:
FunctionEnd

; 找本机已有的 Orbit 安装目录。三级兜底，每一级都要真的看到 exe 才认（防误判）：
;   ① 自己写的 InstallLocation（1.0.5 起会写）
;   ② 注册表里的 UninstallString 反推目录（1.0.0~1.0.4 只写了这个）
;   ③ $INSTDIR 的默认值（per-user 安装即 $LOCALAPPDATA\Programs\Orbit 星账）
;
; 根键一律写成 **HKCU**：本应用是 per-user 安装（`perMachine: false`），卸载信息就在 HKCU。
; 早先这里用的是 `SHELL_CONTEXT`，而它在 `.onInit` 阶段（customInit 所在）**还没被赋值**，
; 于是两条注册表读取全部落空 —— 明明装着旧版本却判成「全新安装」，位置页冒出来、
; 用户一路下一步就把数据路径写成了默认值（1.1.7 那次线上事故的真正原因）。
Function FindExistingInstall
  StrCpy $ExistingDir ""

  ReadRegStr $0 HKCU "${ORBIT_UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
    IfFileExists "$0\${ORBIT_EXE}" 0 inLocDone
    StrCpy $ExistingDir "$0"
    Goto found
    inLocDone:
  ${EndIf}

  ReadRegStr $0 HKCU "${ORBIT_UNINSTALL_KEY}" "UninstallString"
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

; 位置选择页：**首次安装**与**换位置安装**时出现；只有「原地更新」才跳过 ——
; 选更新的人看不到这一页（路径一个字都不变），首次装的人则能自己挑地方。
Function DestPageCreate
  ${If} $ExistingDir != ""
  ${AndIf} $InstallChoice != "move"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $DestPage
  ${If} $DestPage == error
    Abort
  ${EndIf}

  StrCpy $MoveDir "$INSTDIR"
  ; 数据目录预填：**先看上次配置**（更新时沿用原处，用户不改就回到原来那本账）；
  ; 没有配置才用默认位置。这是「覆盖更新不该把数据指到别处」的关键一步。
  Call ReadPrevDataDir
  ${If} $HasPrevDataDir == "1"
  ${AndIf} $PrevDataDir != ""
    StrCpy $DataDirValue "$PrevDataDir"
  ${Else}
    StrCpy $DataDirValue "$APPDATA\Orbit 星账"
  ${EndIf}
  ${If} $ExistingDir == ""
    ${NSD_CreateLabel} 0 0 100% 18u "选择安装位置（默认在系统盘的用户目录下，可改到别的盘）："
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 18u "选择新的安装位置（原来的 $ExistingDir 会保留，不会删除）："
    Pop $0
  ${EndIf}
  ${NSD_CreateText} 0 30u 77% 14u "$MoveDir"
  Pop $DestField
  ${NSD_CreateBrowseButton} 80% 29u 20% 16u "浏览…"
  Pop $DestBrowse
  ${NSD_OnClick} $DestBrowse DestBrowseDir

  ; 同一页里把**账本数据位置**也交出去：首次安装可以自己定，换位置时也能顺手改。
  ${NSD_CreateLabel} 0 56u 100% 26u "账本数据保存位置（数据库文件 orbit.db；换位置不会自动搬走旧数据）："
  Pop $0
  ${NSD_CreateDirRequest} 0 84u 100% 14u "$DataDirValue"
  Pop $DataDirEdit

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
  ; 数据目录：**只有用户真的改了才写配置**。
  ; 「原地更新且没动这一栏」时置空 ⇒ customInstall 不碰 data-path.txt，
  ; 用户的账本仍指在原来的位置（哪怕位置页因为检测失败而意外露了出来）。
  ${NSD_GetText} $DataDirEdit $0
  ${If} $ExistingDir != ""
  ${AndIf} $InstallChoice != "move"
  ${AndIf} $0 == $DataDirValue
    StrCpy $DataDirValue ""
  ${Else}
    StrCpy $DataDirValue "$0"
  ${EndIf}
FunctionEnd

!endif

; 写安装位置（下次更新靠它找到你）；数据目录**只在用户这次真的填了**才写。
!macro customInstall
  ; 写 HKCU（per-user 安装），与 FindExistingInstall 读取的根键保持一致 ——
  ; 写 SHELL_CONTEXT、读 HKCU 会各写各的，下次更新照样认不出已安装的版本。
  WriteRegStr HKCU "${ORBIT_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"  ; 数据配置**只在页面给出非空值时才写**：DestPageLeave 已经保证「原地更新且没改这一栏」
  ; 时它是空的，于是那种情况下这里什么都不做，data-path.txt 逐字节保持原样。
  ; （首次安装、换位置安装、以及用户主动改了路径 ⇒ 非空 ⇒ 正常写入。）
  ${If} $DataDirValue != ""
    ; 必须写 UTF-16LE + BOM：NSIS 的 FileWrite 走系统 ANSI，中文路径会变乱码，
    ; 应用按 UTF-8 读就会凭空建出乱码目录并把库写进去（实测踩过）。
    ClearErrors
    CreateDirectory "$APPDATA\Orbit 星账"
    FileOpen $0 "$APPDATA\Orbit 星账\data-path.txt" w
    FileWriteByte $0 255
    FileWriteByte $0 254
    FileWriteUTF16LE $0 "$DataDirValue"
    FileClose $0
  ${EndIf}
!macroend

; 卸载保护：卸载器接下来会 `RMDir /r $INSTDIR`，而用户完全可能把账本放在程序目录里
;（或者它下面一层，比如 $INSTDIR\store\orbit.db）。**无条件先救出去**再谈别的：
; CopyFiles 找不到文件只是静默失败，代价仅仅是一个可能为空的目录；
; 而"先检测再救"一旦检测方式不灵（通配符匹配子目录这种事很容易踩空），
; 结果就是数据被静默删掉 —— 所以这里选前者。
; 救出位置固定为 $APPDATA\Orbit 星账\卸载救出\，不会被这次卸载带走。
; 交互卸载在救完之后再告知一句；静默卸载（自动更新流程）不打断。
!macro customUnInstall
  ; 先留一个痕迹：这次卸载是否真的跑到了本钩子（排查用，不影响功能）
  ClearErrors
  FileOpen $9 "$APPDATA\Orbit 星账\uninstall-hook.txt" w
  IfErrors unNoMark
  FileWrite $9 "customUnInstall ran, INSTDIR=$INSTDIR"
  FileClose $9
  unNoMark:
  CreateDirectory "$APPDATA\Orbit 星账\卸载救出"
  CopyFiles /SILENT "$INSTDIR\orbit.db*" "$APPDATA\Orbit 星账\卸载救出"
  CopyFiles /SILENT "$INSTDIR\store\orbit.db*" "$APPDATA\Orbit 星账\卸载救出"
  CopyFiles /SILENT "$INSTDIR\*\orbit.db*" "$APPDATA\Orbit 星账\卸载救出"
  IfSilent unDone
  IfFileExists "$APPDATA\Orbit 星账\卸载救出\orbit.db" 0 unDone
  MessageBox MB_OK|MB_ICONINFORMATION "安装目录里发现有账本数据，已复制到：$\r$\n$APPDATA\Orbit 星账\卸载救出$\r$\n$\r$\n程序目录接下来会被清空，你的账本不会丢。"
  unDone:
!macroend
