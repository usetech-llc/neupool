#!/bin/sh

# check os type
isWin=false
case "$(uname -s)" in

   Darwin)
     ;;

   Linux)
     ;;

   CYGWIN*|MINGW32*|MSYS*)
	isWin=true
	 ;;

   *)
     ;;
esac


search_dir=./test
for entry in `ls $search_dir/*.js`; do
	echo $entry
	if($isWin) 
		then port=`netstat -aon | head | gawk ' $2~/:8545/ {print $5} '`
		else port=`lsof -i:8545 -t`
	fi
	if [[ "$port" -ne "" ]]; then
		if($isWin) 
			then Taskkill -F //PID $port
			else kill -9 $port
		fi
	fi
	echo 'Restart testrpc'
	./test/testrpc.sh > null &
	echo "run truffle test $entry"
	truffle test $entry
done