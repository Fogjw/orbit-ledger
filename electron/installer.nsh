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

  ; 覆盖更新：预填上次的路径，用户直接「下一步」就还是同一个账本
  ${If} $HasPrevDataDir == "1"
    ${NSD_CreateLabel} 0 0 100% 20u "检测到本机已有账本数据。保持下面的路径不变，覆盖更新后仍会读到原来的账本："
    Pop $0
    ${If} $PrevDataDir == ""
      StrCpy $1 "$APPDATA\Orbit 星账"
    ${Else}
      StrCpy $1 "$PrevDataDir"
    ${EndIf}
    ${NSD_CreateDirRequest} 0 24u 100% 14u "$1"
    Pop $DataDirEdit
    ${NSD_CreateLabel} 0 46u 100% 46u "数据库文件 orbit.db 就在这个目录里，更新程序不会删除它。$\r$\n只有确实要换位置时才改这一栏：换位置不会自动搬走旧数据（把旧的 orbit.db 复制过去即可），也不要把它设到程序安装目录内（升级会整体替换该目录）。"
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 20u "选择账本数据的存放位置："
    Pop $0
    ${NSD_CreateDirRequest} 0 24u 100% 14u "$APPDATA\Orbit 星账"
    Pop $DataDirEdit
    ${NSD_CreateLabel} 0 46u 100% 46u "数据库文件 orbit.db 会保存在这里。$\r$\n不要选在程序安装目录内 —— 升级会整体替换该目录，放在里面的账本会被一起清掉。"
    Pop $0
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirEdit $DataDirValue
  ${If} $DataDirValue == ""
    ; 留空＝保持现状：已有配置就不重写，首次安装才落默认值
    ${If} $HasPrevDataDir == "0"
      StrCpy $DataDirValue "$APPDATA\Orbit 星账"
    ${EndIf}
    Return
  ${EndIf}
  ; 数据目录不能落在安装目录里：覆盖更新会先替换掉 $INSTDIR，放里面的账本会被一起删掉。
  ; 只比前缀还不够（D:\orbit2 也以 D:\orbit 开头），所以相等或下一字符是反斜杠才算「在里面」。
  StrLen $1 "$INSTDIR"
  StrCpy $2 "$DataDirValue" $1
  StrCmp $2 "$INSTDIR" 0 notInside
  StrCpy $3 "$DataDirValue" 1 $1
  ${If} $3 == ""
  ${OrIf} $3 == "\"
    MessageBox MB_OK|MB_ICONEXCLAMATION "账本数据目录不能位于程序安装目录内：$\r$\n$INSTDIR$\r$\n$\r$\n升级会整体替换安装目录，放在里面的账本会被一起删掉。请换到别处（例如 $APPDATA\Orbit 星账）后再继续。"
    Abort
  ${EndIf}
  notInside:
FunctionEnd

!macro customInstall
  ; 静默安装（/S）不会走自定义页，这里补读一次已有配置：
  ; 已有配置就什么都不写（沿用原路径），只有真正的首次安装才落默认值 ——
  ; 这一条是「覆盖更新不丢数据」的关键。
  Call ReadPrevDataDir
  ${If} $DataDirValue == ""
    ${If} $HasPrevDataDir == "0"
      StrCpy $DataDirValue "$APPDATA\Orbit 星账"
    ${EndIf}
  ${EndIf}
  ${If} $DataDirValue != ""
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
