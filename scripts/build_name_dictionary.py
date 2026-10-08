#!/usr/bin/env python3
"""Build data/en-names-words.json: curated English names and words -> hiragana.

Usage: python3 -I scripts/build_name_dictionary.py data/en-names-words.json

Source spellings are the common katakana renderings used in Japan; they are
converted to hiragana mechanically (code-point shift), keeping ー.
Conventions: v -> b-row (no ヴ), "th" -> s/z-row, as most Japanese media do.
Have a Japanese-speaking teacher or parent review before launch; this list is
a seed, and families can always edit the tiles in the app.

`japanese` on a word = the everyday Japanese word for it, offered as an
alternative ("Write the Japanese word instead?").
"""
import json, sys

NAMES = """
Olivia オリビア|Emma エマ|Charlotte シャーロット|Amelia アメリア|Ava エイバ|Sophia ソフィア|
Sofia ソフィア|Isabella イザベラ|Mia ミア|Evelyn エブリン|Harper ハーパー|Luna ルナ|Camila カミラ|
Elizabeth エリザベス|Eleanor エレノア|Ella エラ|Abigail アビゲイル|Avery エイブリー|
Scarlett スカーレット|Emily エミリー|Aria アリア|Penelope ペネロピ|Chloe クロエ|Layla レイラ|
Mila ミラ|Nora ノラ|Hazel ヘイゼル|Madison マディソン|Ellie エリー|Lily リリー|Nova ノバ|
Isla アイラ|Grace グレース|Violet バイオレット|Aurora オーロラ|Riley ライリー|Zoey ゾーイ|
Zoe ゾーイ|Willow ウィロー|Emilia エミリア|Stella ステラ|Victoria ビクトリア|Hannah ハンナ|
Addison アディソン|Leah リア|Lucy ルーシー|Eliana エリアナ|Ivy アイビー|Lillian リリアン|
Elena エレナ|Naomi ナオミ|Maya マヤ|Natalie ナタリー|Claire クレア|Audrey オードリー|
Ruby ルビー|Sarah サラ|Anna アナ|Alice アリス|Sadie セイディ|Josephine ジョセフィン|
Charlie チャーリー|Sophie ソフィー|Liz リズ|Lizzie リジー|Maria マリア|Julia ジュリア|
Rose ローズ|Daisy デイジー|Molly モリー|Emery エメリー|Kate ケイト|Amy エイミー|Jasmine ジャスミン|
Liam リアム|Noah ノア|Oliver オリバー|Elijah イライジャ|James ジェームズ|William ウィリアム|
Benjamin ベンジャミン|Lucas ルーカス|Henry ヘンリー|Theodore セオドア|Theo セオ|Jack ジャック|
Levi リーバイ|Alexander アレクサンダー|Alex アレックス|Jackson ジャクソン|Mateo マテオ|
Daniel ダニエル|Michael マイケル|Mason メイソン|Sebastian セバスチャン|Ethan イーサン|
Logan ローガン|Owen オーウェン|Samuel サミュエル|Sam サム|Jacob ジェイコブ|Asher アッシャー|
Aiden エイデン|John ジョン|Joseph ジョセフ|Wyatt ワイアット|David デビッド|Leo レオ|Luke ルーク|
Julian ジュリアン|Hudson ハドソン|Grayson グレイソン|Matthew マシュー|Ezra エズラ|
Gabriel ガブリエル|Carter カーター|Isaac アイザック|Jayden ジェイデン|Luca ルカ|
Anthony アンソニー|Dylan ディラン|Lincoln リンカーン|Thomas トーマス|Tom トム|Elias エライアス|
Charles チャールズ|Caleb ケイレブ|Christopher クリストファー|Miles マイルズ|Andrew アンドリュー|
Joshua ジョシュア|Nathan ネイサン|Nolan ノーラン|Adrian エイドリアン|Cameron キャメロン|
Santiago サンティアゴ|Eli イーライ|Aaron アーロン|Ryan ライアン|Cooper クーパー|Easton イーストン|
Kai カイ|Christian クリスチャン|Landon ランドン|Roman ローマン|Axel アクセル|Brooks ブルックス|
Jonathan ジョナサン|Robert ロバート|Ian イアン|Everett エベレット|Wesley ウェスリー|
Hunter ハンター|Leonardo レオナルド|Jordan ジョーダン|Jose ホセ|Bennett ベネット|Ben ベン|
Silas サイラス|Nicholas ニコラス|Parker パーカー|Austin オースティン|Connor コナー|
Dominic ドミニク|Xavier ザビエル|Max マックス|Finn フィン|Jasper ジャスパー|Felix フェリックス|
Oscar オスカー|Arthur アーサー|Peter ピーター|Paul ポール|Mark マーク|Adam アダム|Evan エバン
"""

# English word | katakana sound | everyday Japanese word (hiragana) or ""
WORDS = """
dog ドッグ いぬ|cat キャット ねこ|rabbit ラビット うさぎ|bear ベア くま|fish フィッシュ さかな|
bird バード とり|flower フラワー はな|tree ツリー き|sun サン たいよう|moon ムーン つき|
star スター ほし|rain レイン あめ|rainbow レインボー にじ|apple アップル りんご|
banana バナナ ばなな|strawberry ストロベリー いちご|water ウォーター みず|mom マム おかあさん|
dad ダッド おとうさん|friend フレンド ともだち|school スクール がっこう|car カー くるま|
train トレイン でんしゃ|red レッド あか|blue ブルー あお|yellow イエロー きいろ|green グリーン みどり|
white ホワイト しろ|black ブラック くろ|pink ピンク ぴんく|one ワン いち|two ツー に|three スリー さん|
dinosaur ダイナソー きょうりゅう|cake ケーキ けーき|heart ハート はーと|thank-you サンキュー ありがとう|
hello ハロー こんにちは|good-morning グッドモーニング おはよう|good-night グッドナイト おやすみ|
love ラブ だいすき|family ファミリー かぞく|baby ベビー あかちゃん|ice-cream アイスクリーム あいすくりーむ
"""

def kata_to_hira(s):
    return "".join(chr(ord(c) - 0x60) if 0x30A1 <= ord(c) <= 0x30F6 else c for c in s)

SMALL = set("ぁぃぅぇぉゃゅょゎ")

def mora(h):
    # Small ya/yu/yo/vowels join the previous kana; っ and ー count as a beat.
    return sum(1 for c in h if c not in SMALL)

def entries(block):
    for item in block.replace("\n", "").split("|"):
        item = item.strip()
        if item:
            yield item.split(" ")

names, words = {}, {}
for en, kata in entries(NAMES):
    h = kata_to_hira(kata)
    names[en.lower()] = {"display": en, "katakana": kata, "hiragana": h, "mora": mora(h), "glyphs": len(h)}
for en, kata, ja in entries(WORDS):
    h = kata_to_hira(kata)
    key = en.lower().replace("-", " ")
    words[key] = {"display": key, "katakana": kata, "hiragana": h, "mora": mora(h), "glyphs": len(h),
                  "japanese": ja or None}

doc = {
    "meta": {
        "status": "Seed list - review with a Japanese speaker before launch.",
        "conventions": "v->b row, th->s/z row, ー kept; katakana converted to hiragana by code-point shift.",
        "lookup": "lower-case the input, trim, collapse spaces; try names, then words, then the C2K model fallback.",
    },
    "names": names,
    "words": words,
}
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1))
print(len(names), "names,", len(words), "words; max mora", max(v["mora"] for v in {**names, **words}.values()))
