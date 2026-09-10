; Orbit 星账 · NSIS 安装向导扩展
; 作用：在「选择安装目录」之后追加一页，让用户指定**账本数据目录**。
; 为什么单独一页：程序目录是可替换的（升级会覆盖），而账本数据是用户的资产，
; 两者混在一起最容易在重装/升级时出事，所以默认分开放，并把选择权交给用户。
; 选择结果写到 %APPDATA%\Orbit 星账\data-path.txt，主进程启动时读取（见 electron/main.js 的 dataDir()）。
; 写成纯文本而非注册表：用户自己也能打开看一眼、甚至直接改。
;
; 注意：NSIS 是两阶段构建（先卸载器、后安装器），本文件在两个阶段都会被包含。
; 自定义页与函数只属于安装器，必须用 !ifndef BUILD_UNINSTALLER 围住 ——
; 否则卸载器阶段会出现「函数未被引用」警告，而 electron-builder 把警告当错误。

!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var DataDirPage
Var DataDirEdit
Var DataDirValue

; electron-builder 支持的锚点：紧跟「选择安装目录」之后
!macro customPageAfterChangeDir
  Page custom DataDirPageCreate DataDirPageLeave
!macroend

Function DataDirPageCreate
  nsDialogs::Create 1018
  Pop $DataDirPage
  ${If} $DataDirPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "选择账本数据的存放位置："
  Pop $0
  ${NSD_CreateDirRequest} 0 24u 100% 14u "$APPDATA\Orbit 星账"
  Pop $DataDirEdit
  ${NSD_CreateLabel} 0 46u 100% 40u "数据库文件 orbit.db 会保存在这里。$\r$\n换位置不会自动搬走旧数据 —— 需要的话把旧的 orbit.db 复制过去即可。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirEdit $DataDirValue
  ${If} $DataDirValue == ""
    StrCpy $DataDirValue "$APPDATA\Orbit 星账"
  ${EndIf}
FunctionEnd

!macro customInstall
  ; 静默安装（/S）不会走自定义页，这里补一次默认值，避免写出空配置
  ${If} $DataDirValue == ""
    StrCpy $DataDirValue "$APPDATA\Orbit 星账"
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
!macroend

!endif
