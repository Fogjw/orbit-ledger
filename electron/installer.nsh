; Orbit 星账 · NSIS 安装向导扩展
; 作用：在「选择安装目录」之后追加一页，让用户指定**账本数据目录**。
; 为什么单独一页：程序目录是可替换的（升级会覆盖），而账本数据是用户的资产，
; 两者混在一起最容易在重装/升级时出事，所以默认分开放，并把选择权交给用户。
; 选择结果写到 %APPDATA%\Orbit 星账\data-path.txt，主进程启动时读取（见 electron/main.js 的 dataDir()）。
; 写成纯文本而非注册表：用户自己也能打开看一眼、甚至直接改。
;
; 覆盖更新（同一台机器上再装一次）时本页的行为，是这一版的重点：
;   · 已存在配置 ⇒ 预填上次的路径、并**沿用**它，用户什么都不改就还是同一个账本；
;   · 静默安装（/S，不走本页）同样沿用，绝不把配置重置成默认值 ——
;     数据路径一旦被改成别处，用户看到的就等同于「账本全没了」；
;   · 首次安装才落默认值，并把数据目录挡在程序安装目录之外（升级会整体替换该目录）。
;
; 注意：NSIS 是两阶段构建（先卸载器、后安装器），本文件在两个阶段都会被包含。
; 自定义页与函数只属于安装器，必须用 !ifndef BUILD_UNINSTALLER 围住 ——
; 否则卸载器阶段会出现「函数未被引用」警告，而 electron-builder 把警告当错误。

!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var DataDirPage
Var DataDirEdit
Var DataDirValue     ; 要写进配置的路径；空字符串＝保持现状（不重写配置文件）
Var PrevDataDir      ; 上次配置里的路径（能读出内容才有值）
Var HasPrevDataDir   ; 是否已有配置文件（"1"/"0"）
Var RescueDir        ; 安装前从安装目录里抢救出来的账本（暂存在 $PLUGINSDIR，装完放回原位）；空＝没有要救的
Var DataDirHint      ; 本页输入框下面那行说明（随「已装过 / 有旧数据 / 全新」三种情况变化）

; 读取上次写入的数据目录配置（UTF-16LE + BOM，格式见下面的 customInstall）。
; 覆盖更新时必须沿用这个值 —— 否则装完应用会去读一个新目录，用户看到的就是「账本全没了」。
; 只认 UTF-16LE（那是我们自己写的格式）；读不出内容也算「已存在」，此时留空表示不重写，
; 比猜一个默认值安全。
Function ReadPrevDataDir
  StrCpy $PrevDataDir ""
  StrCpy $HasPrevDataDir "0"
  IfFileExists "$APPDATA\Orbit 星账\data-path.txt" 0 done
  StrCpy $HasPrevDataDir "1"
  FileOpen $0 "$APPDATA\Orbit 星账\data-path.txt" r
  IfErrors done
  FileReadByte $0 $1        ; BOM 第 1 字节
  FileReadByte $0 $2        ; BOM 第 2 字节
  ${If} $1 == 255
  ${AndIf} $2 == 254
    FileReadUTF16LE $0 $PrevDataDir
  ${EndIf}
  FileClose $0
  done:
FunctionEnd

; 判断一个路径是否落在程序安装目录里（就是它，或位于它下面）。
; 调用约定：调用前把待判路径放进 $1，调用后 $0 = "1"/"0"。
; 为什么单独成函数：GUI（离开本页时）与静默安装（customInstall）两条路径必须用同一套判断。
; 只比字符串前缀不够 —— D:\orbit2 也以 D:\orbit 开头，所以还要看下一个字符是不是反斜杠。
Function IsInsideInstallDir
  StrCpy $0 "0"
  ${If} $1 == ""
    Return
  ${EndIf}
  StrLen $2 "$INSTDIR"
  StrCpy $3 "$1" $2
  StrCmp $3 "$INSTDIR" 0 notInside
  StrCpy $4 "$1" 1 $2
  ${If} $4 == ""
  ${OrIf} $4 == "\"
    StrCpy $0 "1"
  ${EndIf}
  notInside:
FunctionEnd

; 时机最早的一步：**在旧版本被卸载之前**把账本请出来。
; electron-builder 的安装流程是先 uninstallOldVersion（旧卸载器会 `RMDir /r $INSTDIR`）
; 再释放新文件，而 customInstall 排在释放文件之后 —— 到那时账本已经被删了，救不回来。
; 所以这里（.onInit 阶段）就把 orbit.db* 复制到 $PLUGINSDIR 暂存，装完由 customInstall 放回原处。
; 用户选的路径一个字都不改。
; 这里**不判断**"账本是不是真在安装目录里"：$INSTDIR 在 .onInit 阶段未必等于最终的安装目录
; （GUI 下用户还能改、安装器之后还会补一层应用名子目录），判断失准就会漏救；
; 而无条件复制一份的代价只是几 MB 的磁盘 IO —— 宁可多复制，不可漏。
!macro customInit
  Call ReadPrevDataDir
  ${If} $HasPrevDataDir == "1"
  ${AndIf} $PrevDataDir != ""
    InitPluginsDir
    StrCpy $RescueDir "$PLUGINSDIR\orbit-rescue"
    CreateDirectory "$RescueDir"
    CopyFiles /SILENT "$PrevDataDir\orbit.db*" "$RescueDir"
  ${EndIf}
!macroend

; electron-builder 支持的锚点：紧跟「选择安装目录」之后
!macro customPageAfterChangeDir
  Page custom DataDirPageCreate DataDirPageLeave
!macroend

Function DataDirPageCreate
  Call ReadPrevDataDir
  nsDialogs::Create 1018
  Pop $DataDirPage
  ${If} $DataDirPage == error
    Abort
  ${EndIf}

  ; 「本机已经装过」的判定：安装目录里已经有卸载器。这里不能用 ${isUpdated} ——
  ; 那个条件宏依赖 StdUtils 插件，而本文件被 include 的位置在插件目录注册之前，编译不过。
  ; 已安装时 electron-builder 会跳过「选择安装目录」页，所以 $INSTDIR 就是上次那个目录，
  ; 用户一路「下一步」即可，不需要重新挑路径。
  IfFileExists "$INSTDIR\Uninstall*.exe" 0 notInstalled
  ${NSD_CreateLabel} 0 0 100% 20u "检测到本机已安装 Orbit 星账 —— 这次是更新：程序装回原目录，账本仍放在下面这个位置。"
  Pop $0
  Goto labelDone
  notInstalled:
  ${If} $HasPrevDataDir == "1"
    ${NSD_CreateLabel} 0 0 100% 20u "检测到本机已有账本数据（上次安装留下的）。保持下面的路径不变，就会继续读到原来的账本："
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 20u "选择账本数据的存放位置："
    Pop $0
  ${EndIf}
  labelDone:

  ${If} $HasPrevDataDir == "1"
    StrCpy $1 "$PrevDataDir"
    Call IsInsideInstallDir
    StrCpy $DataDirHint "数据库文件 orbit.db 就在这个目录里，更新程序不会删除它。$\r$\n只有确实要换位置时才改这一栏：换位置不会自动搬走旧数据（把旧的 orbit.db 复制过去即可）。"
    ${If} $0 == "1"
      ; 账本放在了程序安装目录里。这个位置确实会被覆盖更新清掉，但**不因此改用户的路径** ——
      ; 安装器在卸载旧版本之前会先把 orbit.db 暂存起来，装完再放回这里（见 customInit）。
      StrCpy $DataDirHint "这个位置在程序安装目录内：更新时安装器会先把 orbit.db 暂存，装完再放回这里，账本不会丢。$\r$\n只有确实要换位置时才改这一栏（换位置不会自动搬走旧数据）。"
    ${EndIf}
    ${If} $PrevDataDir == ""
      StrCpy $1 "$APPDATA\Orbit 星账"
    ${Else}
      StrCpy $1 "$PrevDataDir"
    ${EndIf}
    ${NSD_CreateDirRequest} 0 24u 100% 14u "$1"
    Pop $DataDirEdit
    ${NSD_CreateLabel} 0 46u 100% 46u "$DataDirHint"
    Pop $0
    nsDialogs::Show
    Return
  ${EndIf}

  ${NSD_CreateDirRequest} 0 24u 100% 14u "$APPDATA\Orbit 星账"
  Pop $DataDirEdit
  ${NSD_CreateLabel} 0 46u 100% 46u "数据库文件 orbit.db 会保存在这里。$\r$\n位置随便挑：万一它落在程序安装目录里，以后更新时安装器也会先把它暂存、装完放回，不会清掉。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirEdit $DataDirValue
  ${If} $DataDirValue == ""
    ; 留空＝保持现状：已有配置就不重写，首次安装才落默认值
    ${If} $HasPrevDataDir == "0"
      StrCpy $DataDirValue "$APPDATA\Orbit 星账"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customInstall
  ; 静默安装（/S）不会走自定义页，这里把「读旧配置」再做一遍：
  ; 已有配置就沿用原路径，只有真正的首次安装才落默认值 —— 这是「覆盖更新不丢账本」的关键。
  Call ReadPrevDataDir
  ${If} $DataDirValue == ""
    ${If} $HasPrevDataDir == "0"
      StrCpy $DataDirValue "$APPDATA\Orbit 星账"
    ${ElseIf} $RescueDir != ""
      ; 静默更新（没走页面）且手上有暂存的账本：落回配置里原来的位置。
      ; 写进去的还是同一个值，等于没改配置。
      StrCpy $DataDirValue "$PrevDataDir"
    ${EndIf}
  ${EndIf}

  ${If} $DataDirValue != ""
    ; 安装前从安装目录里抢救出来的账本，放回用户选定的位置（通常就是它原来待的地方）
    ${If} $RescueDir != ""
      CreateDirectory "$DataDirValue"
      CopyFiles /SILENT "$RescueDir\orbit.db*" "$DataDirValue"
    ${EndIf}
    ; 落盘数据目录配置。**必须写 UTF-16LE + BOM**：
    ; NSIS 的 FileWrite 走系统 ANSI（中文 Windows 下是 GBK），应用若按 UTF-8 读会得到
    ; 乱码路径，进而凭空建出一个乱码目录、把数据库写进去（实测踩过）。
    ClearErrors
    CreateDirectory "$APPDATA\Orbit 星账"
    FileOpen $0 "$APPDATA\Orbit 星账\data-path.txt" w
    FileWriteByte $0 255
    FileWriteByte $0 254
    FileWriteUTF16LE $0 "$DataDirValue"
    FileClose $0
  ${EndIf}
!macroend

!endif
